const Steembot = require('./steembot.js')
const TurnAdmin = require('./turnadmin.js')
const steem = require('steem')
const nacl = require('nacl')
const jetpack = require('fs-jetpack')
const passgen = require('generate-password')
const CHARGE_INTERVAL_INCREMENT = 60000
const wait = async (ms) => new Promise((resolve,reject) => setTimeout(() => resolve(true), ms))
class STurn {

  costructor({
    botfile,
    realm,
    port,
    credentialsfile,
    cryptoboxfile,
  }){
    this.realm = realm
    this.port = port
    this.bot = Steembot.fromFile(botfile)
    this.turn = new TurnAdmin()
    this.credentialsfile = credentialsfile
    this.cryptoboxfile = cryptoboxfile
  }

  async init(){
    this.turn.init()

    await this.bot.init()

    await this.getCredentialsFromFile()
    await this.syncCredentials()

    await this.listenForCredentialRequests()

    await this.syncPublicKey()
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
    return new Promise((resolve,reject) => {
      this.bot.api.comment(
        '', 
        this.bot.username, 
        this.bot.username, 
        'sturn-public-key', 
        'Sturn Public Key', 
        this.cryptobox.public.toString('hex'),
        null,
        (err, res) => err ? reject(err) : resolve(res)
      )
    })
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

  async listenForCredentialRequests(){
    while (await wait(2000)){
      const requests = await this.pollCredentialRequests()

      requests.forEach(async (req) => {
        await this.processCredentialRequest(req)
      })
    }
  }

  async processCredentialRequest({user, nonce, permlink}){
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

    const boxed = nacl.box(iceServerConfig, nonce, pubkey, this.cryptobox.private)

    const voteable_permlinks = await this.postVotables(permlink)

    await this.waitForVotes(voteable_permlinks)

    const credential_permlink = await this.postReply({user, permlink, reply : boxed})

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

  async getUserPublicKey(user = this.steembot.username){
    return new Promise((resolve,reject) => {
      steem.api.getContent(user, 'sturn-public-key', function(err, result) {
        if (err) return reject(err)
        resolve(result.id ? result : null)
      })
    })
  }

  async postVotables(permlink){

  }

  async waitForVotes(permlinks){

  }

  async gotVote({user, permlink}){

  }

  async postReply({user, permlink, reply}){

  }
}