const crypto = require('crypto')

const nacl = require('tweetnacl')
const sc2_sdk = require('sc2-sdk')
const steem = require('steem')

function bufToUint(buf){
  const uint = new Uint8Array(buf.byteLength)
  for (let i = 0; i < buf.byteLength; i++){
    uint[i] = buf[i]
  }
  return uint
}

const sc2_cb = (op, resolve, reject) => (err, res) => {
  if (err) {
    console.warn(`SC2 ERROR: ${op}`)
    console.warn(err)
    return reject(err)
  }
  resolve(res)
} 

const wait = (ms) => new Promise((resolve) => setTimeout(() => resolve(true), ms))

class Service {
  constructor(
    bot,
    provider = (username) => username,
    {
      title = 'Steem Echo Service',
      description = 'sends your username back to you',
      tags = [],
      terms = { cost : 1},
      permlink = crypto.randomBytes(24).toString('hex')
    }
  ) {
    this.bot = bot,
    this.title = title,
    this.description = description,
    this.tags = ['steempay'].concat(tags)
    this.terms = terms
    this.permlink = permlink
    this.provider = provider
    this.votables = []
    this.orders = new Set()
  }

  get json(){
    return {
      title : this.title,
      description : this.description,
      tags : this.tags.slice(1),
      terms : this.terms,
      permlink : this.permlink
    }
  }

  get meta(){
    return {
      tags : this.tags,
      terms : this.terms
    }
  }

  get service_definition(){
    return {
      title : this.title,
      body : this.description,
      meta : this.meta
    }
  }

  async init(){
    await this.postServiceDefinition()
  }

  updateSession({session_permlink, session_service_permlink, votables}){
    this.session_permlink = session_permlink
    this.session_service_permlink = session_service_permlink
    this.votables = votables
    this.orders = new Set()
  }

  async postServiceDefinition(){
    await this.postReply({
      author : this.bot.username,
      permlink : 'steempay-services',
      reply : this.service_definition
    })
  }

  async prepareSession(session_permlink){
    const session_service_permlink = await this.bot.postReply({
      author : this.bot.username,
      permlink : session_permlink,
      reply : {
        title : this.permlink,
        body : this.permlink
      }
    })

    const votables = []

    for (let i = 0; i < this.terms.cost; i++){
      votables.push(await this.bot.postReply({
        author : this.bot.username,
        permlink : this.session_permlink,
        reply : {
          title : this.permlink,
          body : this.permlink
        }
      }))
    }

    return {session_service_permlink, votables, permlink : this.permlink}
  }

  async waitStarted(ms){
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.started), ms)
    })
  }
  
  async waitStopping(ms){
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.stopping), ms)
    })
  }

  async start(){
    this.started = true

    do {
      const orders = await this.getNewPaidOrders()
      for (let buyer of orders){
        this.fulfillOrder(buyer)
      }
    } while(await this.waitStarted(1000))

    this.stopping = false
  }

  async stop(){
    this.stopping = true
    this.started = false
    while (await this.waitStopping(1000)){}
  }

  async getNewPaidOrders(){
    const new_orders = (await this.getActiveVotes({
      author : this.bot.username,
      permlink : this.session_service_permlink
    })).map(({voter}) => voter).filter(voter => this.orders.has(voter))

    let paid_orders = []

    for (let voter of new_orders){
      const paid = await Promise.all(this.votables.map((permlink) => this.getActiveVotes({
        author : this.username,
        permlink,
        voter
      }))).reduce((_paid, _votes) => _paid && _votes.length, true)
      
      if (paid){
        paid_orders.push(voter)
      }
    }

    return paid_orders
  }

  async fulfillOrder(buyer){
    return this.bot.replyEncrypted({
      author : buyer,
      permlink : 'steempay-delivieries',
      reply : {
        permlink : `delivery-${this.session_service_permlink}`,
        body : await this.provider(buyer)
      }
    })
  }
}

class Client {

  constructor({
    sc2,
    username,
    keypair = nacl.box.keyPair()
  }){
    this._json = {
      sc2,
      username,
      keypair
    }
    console.log("KEYPAIR", keypair)
    this.username = username

    this._api = sc2_sdk.Initialize(sc2)
    this._keypair = keypair
    this._keypair.publicKey = Buffer.from(this._keypair.publicKey)
    this._keypair.secretKey = Buffer.from(this._keypair.secretKey)
  }

  get api(){
    if (!this._api.options.accessToken) {
      console.error(this._api)
      throw new Error('cannot use api without access token')
    }
    return this._api
  }

  setAccessToken(access_token){
    this._api.setAccessToken(access_token)
  }

  async init(){
    await this.post({
      permlink : 'steempay-root',
      title : "Root",
      body : 'init'
    })

    await this.reply({
      author : this.username,
      permlink : 'steempay-root',
      reply : {
        permlink : 'steempay-deliveries',
        title : 'Deliveries',
        body : this._keypair.publicKey.toString('hex')
      }
    })
  }

  async me(){
    return new Promise((resolve, reject) => {
      this.api.me(sc2_cb('me'))
    })
  }

  async vote(voter, author, permlink, weight){
    return new Promise((resolve, reject) => { 
      this.api.vote(voter, author, permlink, weight, sc2_cb('vote', resolve, reject))
    })  
  } 

  async comment(parentAuthor, parentPermlink, author, permlink, title, body, jsonMetadata){
    return new Promise((resolve, reject) => {
      this.api.comment(parentAuthor, parentPermlink, author, permlink, title, body, jsonMetadata, sc2_cb('comment', resolve, reject))
    })
  }

  async revokeToken(){
    return new Promise((resolve, reject) => {
      this.api.revokeToken(sc2_cb('revokeToken', resolve, reject))
    })
  }

  async reblog(account, author, permlink){
    return new Promise((resolve, reject) => {
      this.api.reblog(account, author, permlink, sc2_cb('reblog', resolve, reject))
    })
  }

  async follow(follower, following){
    return new Promise((resolve, reject) => {
      this.api.follow(follower, following, sc2_cb('follow', resolve, reject))
    })
  }

  async unfollow(unfollower, unfollowing) {
    return new Promise((resolve, reject) => {
      this.api.unfollow(unfollower, unfollowing, sc2_cb('unfollow', resolve, reject))
    })
  }

  async ignore(follower, following) {
    return new Promise((resolve, reject) => {
      this.api.ignore(follower, following, sc2_cb('ignore', resolve, reject))
    })
  }

  async claimRewardBalance(account, rewardSteem, rewardSbd, rewardVests) {
    return new Promise((resolve, reject) => {
      this.api.claimRewardBalance(account, rewardSteem, rewardSbd, rewardVests, sc2_cb('claimRewardBalance', resolve, reject))
    })
  }

  async updateUserMetadata(metadata){
    return new Promise((resolve, reject) => {
      this.api.updateUserMetadata(metadata, sc2_cb('updateUserMetadata', resolve, reject))
    })
  }

  async post({permlink = crypto.randomBytes(32).toString('hex'), title, body, meta}){
    console.log(permlink, title, body, meta)
    try {
      await this.comment('', this.username, this.username, permlink, title, body, meta || null)
    } catch (e) {
      console.warn(e)
      if (e.error_description.indexOf('STEEM_MIN_ROOT_COMMENT_INTERVAL') >= 0){
        console.log("waiting 5 min 5 sec to retry")
        await wait( 5 * 60 * 1000 + 5000)
        return this.post({permlink, title, body, meta})
      } else {
        throw e
      }
    }
    return permlink
  }

  async reply({author, permlink, reply : {permlink : reply_permlink, title = 'reply', body = 'body', meta}}){
    try {
      reply_permlink = reply_permlink || crypto.randomBytes(32).toString('hex')
      await this.comment(author, permlink, this.username, reply_permlink, title, body, meta || null)
      return reply_permlink
    } catch (e) {
      console.warn(e)
      if (e.error_description.indexOf('STEEM_MIN_REPLY_INTERVAL') >= 0){
        console.log("waiting 22 seconds to retry")
        await wait(22 * 1000)
        return this.reply({author, permlink, reply : {permlink : reply_permlink, title, body, meta}})
      } else {
        throw e
      }
    }
  }

  async getPost({author, permlink}){
    return new Promise((resolve, reject) => {
      steem.api.getContent(author, permlink, sc2_cb('getPost', resolve, reject));
    })
  }

  async getUserPublicKey(user){
    const post = await this.getPost({
      author : user,
      permlink : 'steempay-deliveries'
    })

    const pubkey = Buffer.from(post.body, 'hex')
    //this._pubkeys.set(user, pubkey)
    return pubkey
  }



  async getReplies({author = this.username, permlink, commentor, title}){
    return new Promise((resolve, reject) => 
      steem.api.getContentReplies(author, permlink, (err, res) => 
        err ? reject(err) : resolve(res.filter(
          ({title : _title, author : _commentor}) => 
            (!commentor || (commentor === _commentor)) && (!title || (title === _title))
          )
        )
      )
    )
  }

  async replyEncrypted({author, permlink, pubkeyhex, reply : {title, body}}) {
    let pubkey
    try {
      pubkey = Buffer.from(pubkeyhex, 'hex')
    } catch (e){
      pubkey = await this.getUserPublicKey(author)
    }
    console.log(pubkey, pubkey.size, pubkey)
    const nonce = crypto.randomBytes(24)
    console.log("ENCRYPT NONCE", nonce.toString('hex'))
    const box = Buffer.from(nacl.box(
      bufToUint(Buffer.from(body)), 
      bufToUint(nonce), 
      bufToUint(pubkey), 
      bufToUint(this._keypair.secretKey)
    )).toString('hex')

    const reply_permlink = nonce.toString('hex')
    await this.reply({
      author, 
      permlink, 
      reply : {
        permlink : reply_permlink, 
        title, 
        body : box, 
        meta : {"encrypted" : pubkey.toString('hex')}
      }
    })
    return reply_permlink
  }

  async getEncryptedReplies({permlink, commentor, title}){
    const replies = (await this.getReplies({permlink, commentor, title})).filter(({json_metadata}) => {
      const meta = JSON.parse(json_metadata)

      console.log("meta", meta,this._keypair.publicKey.toString('hex'))
      return (meta.encrypted === this._keypair.publicKey.toString('hex'))
    })

    const decrypted = []
    for(let reply of replies){
      const {author, permlink, body} = reply
      const decrypted_body = await this.decryptBody({author, permlink, body})

      decrypted.push({...reply, body : decrypted_body})
    }

    console.log(decrypted)
    return decrypted
  }

  async decryptBody({author, permlink, body}){
    const box = bufToUint(Buffer.from(body, 'hex'))
    const nonce = bufToUint(Buffer.from(permlink, 'hex'))
    const pubkey = bufToUint((await this.getUserPublicKey(author)))
    console.log("DECRYPT NONCE",permlink)
    return Buffer.from(nacl.box.open(box, nonce, pubkey, bufToUint(this._keypair.secretKey) )).toString()
  }

  async placeOrder({seller : author, service_permlink}){
    const {body : session_permlink} = await this.getPost({
      author,
      permlink : 'steempay-root'
    })

    const session_service_permlink = `${session_permlink}-${service_permlink}`

    const votables = (await this.getReplies({
      author,
      permlink : session_service_permlink,
      commentor : author
    })).map(({permlink}) => permlink)

    await Promise.all(votables.map((permlink) => this.vote(this.username, author, permlink, 10000)))

    await this.vote(this.username, author, session_service_permlink, 10000)

    return session_service_permlinks
  }

  async receiveDelivery({seller, order}){
    do {
      const deliveries = await this.getEncryptedReplies({
        author : this.username,
        permlink : 'steempay-deliveries',
        reply_permlink : `delivery-${session_service_permlink}`,
        commentor : seller,
        title : 'DELIVERY'
      })
      if (deliveries.length) return deliveries[0]
    } while(await wait(1000))
  }
}


class Bot extends Client{
  constructor({
    app,
    services = []
  }){
    super()

    this.services = services.map((service) => new Service(this, service.provider, service.config))
  }

  async init(){
    await super.init()

    await this.newSession()
  }

  async waitStarted(ms){
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.started), ms)
    })
  }
  
  async waitStopping(ms){
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.stopping), ms)
    })
  }

  async start(){
    this.started = true

    for (let service of this.services){
      service.start().catch((e) => {
        console.log("service error")
        console.error(e)
      })
    }

    do {
      await this.newSession()
    } while (await this.waitStarted(1000))

    this.stopping = false
  }

  async stop(){
    this.started = false
    tbis.stopping = true

    for (let service of this.services){
      await service.stop()
    }

    while (await this.waitStopping(1000)){}
  }

  async newSession(){
    await this.reply({
      author : this.username,
      permlink : 'steempay-root',
      reply : {
        permlink : 'steempay-sessions',
        title : "Sessions",
        body : "sessions"
      }
    })

    const session_permlink = await this.reply({
      author : this.username,
      permlink : 'steempay-sessions',
      reply : {
        title : 'Session',
        body : 'session'
      }
    })

    const services = new Map()

    for (let service of this.servisces){
      const {session_service_permlink, votables} = await service.prepareSession(session_permlink)
      services.set(service.permlink, {session_service_permlink, votables})
    }

    await this.post({
      permlink : 'steempay-root',
      title : 'Root',
      body : session_permlink
    })

    for (let service of this.services){
      const {session_service_permlink, votables} = services.get(service.permlink)
      service.updateSession({
        session_permlink,
        session_service_permlink,
        votables
      })
    }
  }

  async consumeToken({access_token, refresh_token, expires_in, username}){
    if (access_token && (username === this._json.username) && expires_in && refresh_token){
      this._json.sc2.access_token = access_token
      this._json.sc2.expires_at = Date.now() + (expires_in * 1000)
      this._json.sc2.refresh_token = refresh_token
      this._api.setAccessToken(access_token)
      return true
    }

    return false
  }

  async refreshToken(){
    console.log("requesting refresh", this.refresh_token)
    return new Promise((resolve, reject) => {
      request.get(
        `https://steemconnect.com/api/oauth2/token?refresh_token=${this._json.sc2.refresh_token}&grant_type=refresh_token&client_secret=${this._json.sc2.secret}`,
        (err, res, body) => {
          if (err) return reject(err)
          if (!this.consumeToken(JSON.parse(body))) return reject(body)
          resolve()
        }
      )
    })
  }

  async requestToken(){
    console.log("requesting token ", this._json.code, this._json.secret)
    return new Promise((resolve, reject) => {
      request.get(
        `https://steemconnect.com/api/oauth2/token?code=${this._json.sc2.code}&client_secret=${this._json.sc2.secret}`,
        (err,res, body) => {
          if (err) return reject(err)
          if (!this.consumeToken(JSON.parse(body))) return reject(body)
          resolve()
        }
      )
    })
  }

  async listenForCode(){
    return new Promise((resolve, reject) => {
      this.server = https.createServer({
        cert : fs.readFileSync(this._json.certfile),
        key : fs.readFileSync(this._json.keyfile)
      },(request, response) => {
        const {query : {code}} = url.parse(request.url, true)
        console.log('got query', code)
        if (code) {
          this._json.code = code
          this.emit('update')
          response.statusCode = 200
          response.end(() => {
            this.server.close(() => {
              resolve()
            })
          })
        } else {
          response.statusCode = 500
          response.statusMessage = "Bad Request"
          response.end()
        }
      })

      this.server.on('error', reject)
      this.server.listen(this._json.port || 4443)
    })
  }
}

module.exports = {
  Client,
  Service,
  Bot
}

