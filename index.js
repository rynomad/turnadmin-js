const Steembot = require('./steembot.js')
const TurnAdmin = require('./turnadmin.js')
const steem = require('steem')
const nacl = require('nacl')
const jetpack = require('fs-jetpack')
const passgen = require('generate-password')
const crypto = require('crypto')
const CHARGE_INTERVAL_INCREMENT = 60000
const wait = async (ms) => new Promise((resolve,reject) => setTimeout(() => resolve(true), ms))
class STurn {

  costructor({
    botfile,
    realm,s
    port,
    credentialsfile,
    cryptoboxfile,
    statefile
  }){
    this.realm = realm
    this.port = port
    this.bot = Steembot.fromFile(botfile)
    this.turn = new TurnAdmin()
    this.credentialsfile = credentialsfile
    this.cryptoboxfile = cryptoboxfile
    this.statefile = statefile
  }

  async init(){
    this.turn.init()

    await this.bot.init()
    await this.getCredentialsFromFile()
    await this.syncCredentials()
    await this.syncPublicKey()
    await this.syncStateFile()

    this.listenForCredentialRequests()
  }

  async syncStateFile(){
    this.state = ('file' === jetpack.exists(this.statefile)) ? (await jetpack.readAsync(this.statefile, 'json')) : {}
  }

  async syncPublicKey(){
    this.cryptobox = ('file' === jetpack.exists(this.cryptoboxfile)) ? Object.keys(
      await jetpack.readAsync(this.credentialsfile, 'json')
    ).reduce((o, k) => ({[k] : Buffer.from(o[k], 'hex'), ...o}),{}) : nacl.boxKeypair()
  
    await jetpack.writeAsync(this.credentialsfile, {private : this.cryptobox.private.toString('hex'), public : this.cryptobox.public.toString('hex')}, {
      overwrite : true
    })

    const pubkeypost = await this.getUserPublicKey()

    if (!pubkeypost || (pubkeypost.body !== this.cryptobox.public.toString('hex'))){
      await this.setPublicKeyPost()
    }
  }

  async setPublicKeyPost(){
    await this.bot.comment(
      '', 
      this.bot.username, 
      this.bot.username, 
      'sturn-public-key', 
      'Sturn Public Key', 
      this.cryptobox.public.toString('hex'),
      null
    )
    return 'sturn-public-key'
  }


  async getCredentialsFromFile(){
    this.credentials = ('file' === jetpack.exists(this.credentialsfile)) ? (await jetpack.readAsync(this.credentialsfile)).trim().split('\n').reduce((map, line) => {
      const {user, ...credentials} = JSON.parse(line)
      map.set(user, {user, ...credentials})
      return map
    },new Map()) : new Map()
  }

  async saveCredentialsToFile(){
    const str = ''
    for (let [_, credentials] of this.credentials){
      str += `${JSON.stringify(credentials)}\n`
    }
    return jetpack.writeAsync(this.credentialsfile, str, {overwrite : true})
  }

  async syncCredentials(){
    for (let [user, {password}] of this.credentials){
      await this.turn.addUser({user, password, realm})
    }

    const users = await this.turn.listUsers()

    for (let {user, realm} of users){
      if ((realm !== this.realm) || !this.credentials.has(user)){
        await this.turn.deleteUser({user, realm})
      }
    }

    await this.saveCredentialsToFile()
  }

  translateTurnEvents(){
    this.turn.on('client', ({type, data}) => {
      this.emit(`${data.user}_${type}`, data)
    })
  }

  async userConnect(user){
    return new Promise((resolve, reject) => {
      this.once(`${user}_connect`, (data) => {
        resolve(data)
      })
    })
  }

  async getPublicKeyComments(){
    return new Promise((resolve, reject) => {
      steem.api.getContentReplies(this.bot.username, 'sturn-public-key', (err, res) => err ? reject(err) : resolve(res))
    })
  }

  async pollCredentialRequests(){
    const pubkey_comments = (await this.getPublicKeyComments())

    const requests = []
    for (const {author, permlink} of pubkey_comments){
      if (!(await this.hasVoteFromUser({author, permlink}))){
        await this.vote({author, permlink})
        requests.push({
          user : author,
          permlink
        })
      }
    }

    return requests
  }

  async listenForCredentialRequests(){
    while (await wait(2000)){
      const requests = await this.pollCredentialRequests()

      requests.forEach(async (req) => {
        await this.processCredentialRequest(req)
      })
    }
  }

  async vote({author, permlink}){
    return this.bot.vote(this.bot.username, author, permlink, 100)
  }

  async postReply({user, permlink, reply}){
    const add = crypto.getRandomBytes(32).toString('hex')
    const reply_permlink = `permlink-${add}`
    await this.bot.comment(user, permlink, this.bot.username, reply_permlink,'reply',reply)
    return reply_permlink
  }

  async processCredentialRequest({user, permlink}){
    const password = passgen.generate({
      length : 32,
      numbers : true,
    })

    this.credentials.set(user, {
      user,
      password,
      permlink
    })

    await this.syncCredentials()

    const pubkey = await this.getUserPublicKey(user)
    const nonce = crypto.randomBytes(24)

    const boxed = nacl.box(iceServerConfig, nonce, pubkey, this.cryptobox.private)

    await this.bot.getPaymentAsVote({voter : user, permlink})

    const credential_permlink = await this.bot.reply({user, permlink, reply : `${boxed.toString('hex')}:${nonce.toString('hex')}`})

    const {connection} = await this.userConnect(user) 

    this.credentials.delete(user)

    await this.syncCredentials()

    let charge_interval = CHARGE_INTERVAL_INCREMENT
    let charge_permlink = credential_permlink
    while (await wait(charge_interval)){
      if (!connection.last_usage) return
      
      if ((Date.now() - connection.last_usage.time) < charge_interval){
        const got_vote = await this.gotVote({user, permlink : charge_permlink})
        if (got_vote){
          charge_permlink = await this.postReply({user, permlink : charge_permlink, reply : "usage"})
          charge_interval += CHARGE_INTERVAL_INCREMENT
        } else {
          await this.turn.bootConnection(connection)
        }
      } else {
        return
      }
    }
  }

  async hasVote({user, author = this.bot.username, permlink}){
    return new Promise((resolve,reject) => {
      steem.api.getActiveVotes(author, permlink, (err, res) => {
        if (err) return reject(err)
        for (let {voter} of res){
          if (voter === user) return resolve(true)
        }
        resolve(false)
      })
    })
  }

  async waitForVote({user, permlink}){
    do {
      if (await this.hasVote({user, permlink})) return true
    } while(await wait(1000))
  }

  async postVotables(author, permlink){
    const add = crypto.randomBytes(16).toString('hex')
    const post_permlink = `${permlink}-${add}`
    await this.bot.comment(author, permlink, this.bot.user, post_permlink, "Votable", 'votable',null)
    return post_permlink
  }

  async getUserPublicKey(user = this.steembot.username){
    return new Promise((resolve,reject) => {
      steem.api.getContent(user, 'sturn-public-key', function(err, result) {
        if (err) return reject(err)
        resolve(result.id ? result : null)
      })
    })
  }
}