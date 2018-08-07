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

  async updateSession({session_permlink, session_service_permlink, votables}){
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

    return {session_service_permlink, votables}
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

  async me(){
    return new Promise((resolve, reject) => {
      this.api.me(sc2_cb('me')
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

    const root_post = await this.getPost({
      author : user,
      permlink : 'steempay-root'
    })

    const post = await this.getPost({
      author : user,
      permlink : root_post.body
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

class SteemPay {
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

  async init(){
    await this.newSession()
  }

  async newSession(){
    const root_permlink = 'steempay-root'
    this._root_permlink = this._root_permlink || (await this.post({
      permlink : 'steempay-root',
      title : 'ROOT',
      body  : 'INIT'
    }))

    const session = await this.reply({
      author : this.username,
      permlink : root_permlink,
      reply : {
        title : 'SESSION',
        body : this._keypair.publicKey.toString('hex')
      }
    })

    this._session_permlink = await this.post({
      permlink : root_permlink,
      title : 'ROOT',
      body : session
    })
  }

  async getFollowers(){
    return new Promise((resolve, reject) => {
      steem.api.getFollowers(this.username, '', 'blog', 1000, (err, res) => {
        if (err) return reject(err)
        resolve(res.map(({follower}) => follower))
      })
    })
  }

  async getNewFollowers(){
    this._followers = this._followers || new Set(await this.getFollowers())
    const followers = await this.getFollowers()
    const ret = followers.filter(follower => !this._followers.has(follower))
    this._followers = new Set(followers)
    return ret
  }

  transfer(recipient, qty, memo){
    return this.api.sign('transfer',{
      to : recipient,
      amount : `${qty} STEEM`,
      memo : `#${memo}`
    }, 'http://localhost:4000')
  }
  
  async me(){
    return new Promise((resolve, reject) => {
      this.api.me(sc2_cb('me', resolve, reject))
    })
  }

  async vote(author, permlink, weight){
    return new Promise((resolve, reject) => { 
      this.api.vote(voter, author, permlink, weight, sc2_cb('vote', resolve, reject))
    })  
  } 

  async comment(parentAuthor, parentPermlink, author, permlink, title, body, jsonMetadata){
    return new Promise((resolve, reject) => {
      this.api.comment(parentAuthor, parentPermlink, author, permlink, title, body, jsonMetadata, (err,res) => err ? reject(err) : resolve(res))
    })
  }

  async revokeToken(){
    return new Promise((resolve, reject) => {
      this.api.revokeToken(sc2_cb('op', resolve, reject))
    })
  }

  async reblog(account, author, permlink){
    return new Promise((resolve, reject) => {
      this.api.reblog(account, author, permlink, sc2_cb('op', resolve, reject))
    })
  }

  async follow(follower, following){
    return new Promise((resolve, reject) => {
      this.api.follow(follower, following, sc2_cb('op', resolve, reject))
    })
  }

  async unfollow(unfollower, unfollowing) {
    return new Promise((resolve, reject) => {
      this.api.unfollow(unfollower, unfollowing, sc2_cb('op', resolve, reject))
    })
  }

  async ignore(follower, following) {
    return new Promise((resolve, reject) => {
      this.api.ignore(follower, following, sc2_cb('op', resolve, reject))
    })
  }

  async claimRewardBalance(account, rewardSteem, rewardSbd, rewardVests) {
    return new Promise((resolve, reject) => {
      this.api.claimRewardBalance(account, rewardSteem, rewardSbd, rewardVests, sc2_cb('op', resolve, reject))
    })
  }

  async updateUserMetadata(metadata){
    return new Promise((resolve, reject) => {
      this.api.updateUserMetadata(metadata, (err,res) => err ? reject(err) : resolve(res))
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
      }
    }
  }

  async getPost({author, permlink}){
    return new Promise((resolve, reject) => {
      steem.api.getContent(author, permlink, sc2_cb('getPost', resolve, reject));
    })
  }

  async getUserPublicKey(user){

    const root_post = await this.getPost({
      author : user,
      permlink : 'steempay-root'
    })

    const post = await this.getPost({
      author : user,
      permlink : root_post.body
    })

    const pubkey = Buffer.from(post.body, 'hex')
    //this._pubkeys.set(user, pubkey)
    return pubkey
  }



  async getReplies({author = this.username, permlink, commentor, title , reply_permlink}){
    return new Promise((resolve, reject) => 
      steem.api.getContentReplies(author, permlink, (err, res) => 
        err ? reject(err) : resolve(res.filter(
          ({title : _title, author : _commentor, permlink : _reply_permlink}) => 
            (!commentor || (commentor === _commentor)) && (!title || (title === _title) && (!reply_permlink || (reply_permlink === _reply_permlink)))
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

  async getEncryptedReplies({permlink, commentor, title, reply_permlink}){
    const replies = (await this.getReplies({permlink, commentor, title, reply_permlink})).filter(({json_metadata}) => {
      const meta = JSON.parse(json_metadata)

      console.log("meta", meta,this._keypair.publicKey.toString('hex'))
      return (meta.encrypted === this._keypair.publicKey.toString('hex'))
    })

    const decrypted = []
    for(let reply of replies){
      const {author, permlink, body} = reply
      const decrypted_body = await this.decryptReply({author, permlink, body})

      decrypted.push({...reply, body : decrypted_body})
    }

    console.log(decrypted)
    return decrypted
  }

  async decryptReply({author, permlink, body}){
    const box = bufToUint(Buffer.from(body, 'hex'))
    const nonce = bufToUint(Buffer.from(permlink, 'hex'))
    const pubkey = bufToUint((await this.getUserPublicKey(author)))
    console.log("DECRYPT NONCE",permlink)
    return Buffer.from(nacl.box.open(box, nonce, pubkey, bufToUint(this._keypair.secretKey) )).toString()
  }

  async placeOrder({seller : author, permlink}){
    const advertisement = await this.getPost({
      author,
      permlink
    })
    console.log(advertisement)
    const votables = JSON.parse(advertisement.json_metadata || '[]')
    console.log(votables, votables.length)

    await Promise.all(votables.map((permlink) => this.vote(this.username, author, permlink, 10000)))

    return this.reply({
      author,
      permlink,
      reply : {
        title : 'ORDER',
        body : this._keypair.publicKey.toString('hex')
      }
    })
  }

  async receiveDelivery({seller, order}){
    do {
      const deliveries = await this.getEncryptedReplies({
        author : this.username,
        permlink : 'steempay-deliveries',
        commentor : seller,
        title : 'DELIVERY',
        reply_permlink : `delivery-${order}`
      })
      if (deliveries.length) return deliveries[0]
    } while(await wait(1000))
  }

  async provideService({advertisement, provider, cost}){
    const seen = new Set()
    
    do {
      const new_orders = await this.receiveOrders({advertisement})
      for (let order of new_orders){
        console.log('fulfill order',order )
        this.fulfillOrder({order, provider, cost}).catch(e => {
          console.error(e)
        })
      }
    } while(await wait(1000)) 
  }

  async postAdvertisement({permlink = crypto.randomBytes(32).toString('hex'), terms = {}, cost = 1} = {}){
    await this.reply({
      author : this.username,
      permlink : this._session_permlink,
      reply : {
        permlink,
        title : 'ADVERTISEMENT',
        body : JSON.stringify(terms)
      }
    })

    let last_permlink = permlink
    const votables = [last_permlink]

    for (let i = 1; i < cost; i++){
      last_permlink = await this.reply({
        author : this.username,
        permlink : last_permlink,
        reply : {
          title : 'VOTABLE',
          body : 'votable'
        }
      })
      votables.push(last_permlink)
    }

    await this.reply({
      author : this.username,
      permlink : this._session_permlink,
      reply : {
        permlink,
        title : 'ADVERTISEMENT',
        body : JSON.stringify(terms),
        meta : votables
      }
    })

    return {permlink, votables}
  }

  async getNewPaidOrders({permlink, votables}){
    const replies = await this.getReplies({
      author : this.username,
      permlink : permlink,
      title : 'ORDER'
    })

    let new_orders = []
    for (let {permlink, author, body} of replies){
      const votes = await this.getActiveVotes({
        author,
        permlink,
        voter : this.username
      })
      if (!votes.length){
        new_orders.push({permlink, author, body})
      }
    }

    let paid_orders = []
    for (let {permlink, author, body} of new_orders){
      const votes = await Promise.all(votables.map((permlink) => this.getActiveVotes({
        author : this.username,
        permlink,
        voter : author
      })))

      const paid = votes.reduce((_paid, _votes) => _paid && _votes.length , true)
      
      if (paid){
        paid_orders.push({permlink, author, body})
      }
    }

    for (let {permlink, author} of paid_orders){
      await this.vote(this.username, author, permlink, 10000)
    }
    
    return paid_orders
  }

  async fulfillOrder({order : {author, permlink, body}, payload}){
    await this.replyEncrypted({
      author,
      permlink,
      pubkeyhex : body,
      reply : {
        title : 'DELIVERY',
        body : payload
      }
    })
  }


  async postInvoice({author : last_author, order, quantity = 1}){
    let last_permlink = order
    let head;

    for (let i = 0; i < quantity; i++){
      console.log('post invoice reply', last_author, last_permlink, order,)
      last_permlink = await this.reply({
        author : last_author,
        permlink : last_permlink,
        reply : {
          title : 'INVOICE',
          body : order,
          meta : (i === (quantity - 1)) ? {"end":true} : null
        }
      })
      last_author = this.username
      head = head || last_permlink
    }

    return head
  }

  async getNextInvoiceComment({author, permlink}){
    const comments = await this.getReplies({author, permlink, commentor : author, title : "INVOICE"})
    return comments[0] ? comments[0].permlink : null
  }

  async receivePayment({permlink, buyer}){
    while (permlink){
      console.log("receive payment", permlink)
      await this.waitForActiveVote({permlink, voter : buyer})
      permlink = await this.getNextInvoiceComment({author : this.username, permlink})
    }
  }

  async waitForActiveVote({permlink, voter}){
    do {
      const votes = await this.getActiveVotes({voter, permlink})
      if (votes.length) return votes[0]
    } while(await wait(1000))
  }

  async getActiveVotes({author = this.username, voter, permlink}){
    return new Promise((resolve,reject) => {
      steem.api.getActiveVotes(author, permlink, (err, res) => {
        if (err) return reject(err)
        const votes = []
        for (let vote of res){
          if (!voter || (voter === vote.voter)) votes.push(vote)
        }
        resolve(votes)
      })
    })
  }

  async sendDelivery({order, buyer, payload}){
    await this.replyEncrypted({
      author : buyer,
      permlink : order,
      reply : {
        title : 'DELIVERY',
        body : payload
      }
    })
  }
}

module.exports = SteemPay