const nacl = require('tweetnacl')
const sc2_sdk = require('sc2-sdk')

class SteemPay {
  constructor({
    sc2,
    username
  }){
    this._json = {
      sc2,
      username
    }

    this._api = sc2_sdk.Initialize(sc2)
    this._cryptobox = nacl.box.keyPair()
  }

  get api(){
    if (!this._api.accessToken) throw new Error('cannot use api without access token')
    return this._api
  }
  
  async me(){
    return new Promise((resolve, reject) => {
      this.api.me((err, res) => err ? reject(err) : resolve(res))
    })
  }

  async vote(voter, author, permlink, weight){
    return new Promise((resolve, reject) => { 
      this.api.vote(voter, author, permlink, weight, (err, res) => err ? reject(err) : resolve(res))
    })  
  } 

  async comment(parentAuthor, parentPermlink, author, permlink, title, body, jsonMetadata){
    return new Promise((resolve, reject) => {
      this.api.comment(parentAuthor, parentPermlink, author, permlink, title, body, jsonMetadata, (err,res) => err ? reject(err) : resolve(res))
    })
  }

  async revokeToken(){
    return new Promise((resolve, reject) => {
      this.api.revokeToken((err, res) => err ? reject(err) : resolve(res))
    })
  }

  async reblog(account, author, permlink){
    return new Promise((resolve, reject) => {
      this.api.reblog(account, author, permlink, (err, res) => err ? reject(err) : resolve(res))
    })
  }

  async follow(follower, following){
    return new Promise((resolve, reject) => {
      this.api.follow(follower, following, (err, res) => err ? reject(err) : resolve(res))
    })
  }

  async unfollow(unfollower, unfollowing) {
    return new Promise((resolve, reject) => {
      this.api.unfollow(unfollower, unfollowing, (err, res) => err ? reject(err) : resolve(res))
    })
  }

  async ignore(follower, following) {
    return new Promise((resolve, reject) => {
      this.api.ignore(follower, following, (err, res) => err ? reject(err) : resolve(res))
    })
  }

  async claimRewardBalance(account, rewardSteem, rewardSbd, rewardVests) {
    return new Promise((resolve, reject) => {
      this.api.claimRewardBalance(account, rewardSteem, rewardSbd, rewardVests, (err, res) => err ? reject(err) : resolve(res))
    })
  }

  async updateUserMetadata(metadata){
    return new Promise((resolve, reject) => {
      this.api.updateUserMetadata(metadata, (err,res) => err ? reject(err) : resolve(res))
    })
  }

  async reply({author, permlink, reply : {title = 'reply', body = 'body', metas = null}}){
    const add = crypto.getRandomBytes(32).toString('hex')
    const reply_permlink = `permlink-${add}`
    await this.comment(author, permlink, this.username, title, body, meta)
    return reply_permlink
  }

  async hasActiveVote({voter : _voter, author = this.bot.username, permlink}){
    return new Promise((resolve,reject) => {
      steem.api.getActiveVotes(author, permlink, (err, res) => {
        if (err) return reject(err)
        for (let {voter} of res){
          if (voter === _voter) return resolve(true)
        }
        resolve(false)
      })
    })
  }

  async getContentReplies(author, permlink){
    return new Promise((resolve, reject) => {
      steem.api.getContentReplies(author, permlink, (err, res) => err ? reject(err) : resolve(res))
    })
  }

  async getNextInvoiceComment({author, nonce, permlink}){
    const comments = (await this.getContentReplies(author, permlink)).filter(({body, title, author}) => (body === nonce) && (author === this.username))
    return comments[0] ? comments[0].permlink : null
  }

  async waitForActiveVote({author = this.username, permlink, nonce, voter}){
    do {
      if (await this.hasActiveVote({voter, author, permlink})) return await this.getNextInvoiceComment({author, nonce, permlink})
    } while(await wait(1000))
  }

  async publicInvoiceComment({author, permlink, nonce}){
    const votable_permlink = `${permlink}-${crypto.getRandomBytes(32).toString('hex')}`
    await this.comment(author, permlink, this.username, votable_permlink, `INVOICE`, nonce, null)
    return votable_permlink
  }

  async publishInvoice({author : last_author, permlink : last_permlink, voter, quantity = 1}){
    const voter = last_author
    const nonce = crypto.getRandomBytes(32).toString('hex')
    for (let i = 0; i < quantity; i++){
      last_permlink = await this.commentInvoice({author : last_author, permlink : last_permlink, nonce})
      last_author = this.username
    }
    return {
      voter, 
      nonce
    }
  }

  async receivePayment({permlink : last_permlink, voter, nonce}){
    while (last_permlink){
      last_permlink = await this.waitForActiveVote({author : this.username, permlink : last_permlink, nonce, voter})
      last_author = this.username
    }
  }

  async placeOrder({author, permlink}){
    const order = crypto.getRandomBytes(64).toString('hex')
    await this.comment(author, permlink, this.username, order, `ORDER`, order, null)
    return {
      seller : author,
      buyer : this.username,
      order
    }
  }

  async waitForInvoiceComment({author, permlink, seller, order}){
    do {
      const comments = (await this.getContentReplies(author, permlink)).filter(({author, title, json_metadata}) => {
        return ((author === seller) && (title === 'INVOICE') && (body === order))
      })

      if (comments[0]){
        const {permlink, author, json_metadata} = comments[0]
        return {
          permlink,
          author,
          seller,
          order,
          json_metadata
        }
      }
    } while (await wait(1000))
  }

  async receiveInvoice({author : last_author, permlink : last_permlink}){
    const invoice = []
    let done = false

    do {
      invoice_comment = this.waitForInvoiceComment({last_author, last_permlink})
      last_author = invoice_comment.author
      last_permlink = invoice_comment.permlink
      done = !!(invoice_comment.json_metadata)
      invoice.push(invoice_comment)
    } while (!done)

    return invoice
  }

  async payInvoice(comments){
    for (let {author, permlink} of comments){
      await this.vote(this.username, author, permlink, 100)
    }
  }

  async receiveDelivery({seller, order}){
    do {
      const replies = (await this.getContentReplies(this.username, order)).filter(({title, author}) => (title === 'DELIVERY') && (author === seller))
      if (replies[0]) {
        const {body, permlink, author} = replies[0]
        const box = Buffer.from(body, 'hex')
        const nonce = Buffer.from(permlink, 'hex')
        const pubkey = await this.getUserPublicKey(author)
        return nacl.box.open(box, nonce, pubkey, this.keyPair.private )
      }
    } while(await wait(1000))
  }

  async encryptedComment(author, permlink, title, payload){
    const pubkey = await this.getUserPublicKey(author)
    const nonce = crypto.getRandomBytes(24)
    const box = nacl.box(payload, 24, pubkey, this.keypoar.private)
    await this.comment(author, permlink, this.username, nonce.toString('hex'), title, box.toString('hex'))
  }

  async sendDelivery({order, buyer, payload}){
    const permlink = crypto.getRandomBytes(64).toString('hex')
    await this.encryptedComment(buyer, order, this.username, permlink, 'DELIVERY', payload)
  }
}