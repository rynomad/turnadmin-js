const nacl = require('tweetnacl')
const sc2_sdk = require('sc2-sdk')
const steem = require('steem')

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

  async post({permlink = crypto.getRandomBytes(64).toString('hex'), title, body, meta}){
    await this.comment('', this.username, this.username, permlink, title, body, meta)
    return permlink
  }

  async reply({author, permlink, reply : {title = 'reply', body = 'body', meta}}){
    const reply_permlink = crypto.getRandomBytes(32).toString('hex')
    await this.comment(author, permlink, this.username, reply_permlink, title, body, meta)
    return reply_permlink
  }

  async getPost({author, permlink}){
    return new Promise((resolve, reject) => {
      steem.api.getContent(author, permlink, (err, res) => err ? reject(err) : resolve(res));
    })
  }

  async getUserPublicKey(user){
    if (this._pubkeys.has(user)) return this._pubkeys.get(user)

    const post = await this.getPost({
      author : user,
      permlink : 'STEEMPAY-PUBLIC-KEY'
    })

    const pubkey = Buffer.from(post.body, 'hex')
    this._pubkeys.set(user, pubkey)
    return pubkey
  }

  async postPublicKey(){
    await this.post({
      permlink : 'STEEMPAY-PUBLIC_KEY',
      title : 'Public Key',
      body : this.keypair.public.toString('hex')
    })
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

  async replyEncrypted({author, permlink, reply : {title, body}}) {
    const pubkey = await this.getUserPublicKey(author)
    const nonce = crypto.getRandomBytes(24)
    const box = nacl.box(body, 24, pubkey, this.keypair.private)
    const permlink = nonce.toString('hex')
    await this.comment(author, permlink, this.username, nonce.toString('hex'), title, box.toString('hex'))
    return permlink
  }

  async decryptReply({author, permlink, body}){
    const box = Buffer.from(body, 'hex')
    const nonce = Buffer.from(permlink, 'hex')
    const pubkey = await this.getUserPublicKey(author)
    return nacl.box.open(box, nonce, pubkey, this.keyPair.private )
  }

  async placeOrder({author, permlink}){
    return this.reply({
      author,
      permlink,
      reply : {
        title : 'ORDER'
      }
    })
  }

  async receiveInvoice({permlink : last_permlink}){
    const invoice = []
    let done = false
    let last_author = this.username

    do {
      invoice_comment = await this.waitForInvoiceComment({last_author, last_permlink})
      last_author = invoice_comment.author
      last_permlink = invoice_comment.permlink
      done = !!(invoice_comment.json_metadata)
      invoice.push(invoice_comment)
    } while (!done)

    return invoice
  }

  async waitForInvoiceComment({author, permlink, seller}){
    do {
      const comments = await this.getReplies({
        author,
        permlink,
        commentor : seller,
        title : 'INVOICE'
      })

      if (comments[0]){
        return comments[0].permlink
      }
    } while (await wait(1000))
  }

  async payInvoice({seller, invoice}){
    for (let permlink of invoice){
      await this.vote(this.username, seller, permlink, 10000)
    }
  }

  async receiveDelivery({seller, order}){
    do {
      const replies = await this.getReplies({
        author : this.username,
        permlink : order,
        commentor : seller,
        title : 'DELIVERY'
      })
      if (replies[0]) {
        return this.decryptReply(replies[0])
      }
    } while(await wait(1000))
  }

  async provideService({description, provider, cost}){
    const advertisement = await this.postAdvertisement({body : description})
    const seen = new Set()
    
    do {
      const new_orders = await this.receiveOrders({seen, advertisement})
      for (let order of new_orders){
        this.fulfillOrder({order, provider, cost})
      }
    } while(await wait(1000)) 
  }

  async postAdvertisement({body, meta}){
    return this.post({
      title : 'ADVERTISEMENT',
      body,
      meta
    })
  }

  async receiveOrders({seen, advertisement}){
    do {
      const replies = await this.getReplies({
        author : this.username,
        permlink : advertisement,
        title : 'ORDER'
      })

      const new_orders = []

      for (let {permlink : order, title, author} of replies){
        if ((title === 'ORDER') && (!seen.has(order))){
          seen.add(order)
          new_orders.push({order, title, buyer : author})
        }
      }

      if (new_orders.length) return new_orders

    } while(await wait(1000))
  }

  async fulfillOrder({order : {order, title, buyer}, provider, cost}){
    const permlink = await this.postInvoice({
      author : buyer,
      order,
      quantity : cost
    })

    await this.receivePayment({
      permlink,
      buyer,
    })

    const delivery = await provider({buyer})

    await this.sendDelivery({
      order,
      buyer,
      payload : delivery
    })
  }


  async postInvoice({author : last_author, order, quantity = 1}){
    let last_permlink = order
    let head;

    for (let i = 0; i < quantity; i++){
      last_permlink = await this.reply({
        author : last_author,
        permlink : last_permlink,
        reply : {
          title : 'INVOICE',
          body : order,
          meta : (i === quantity - 1) ? `{"end":true}` : null
        }
      })
      last_author = this.username
      head = head || last_permlink
    }

    return head
  }

  async getNextInvoiceComment({author, nonce, permlink}){
    const comments = (await this.getContentReplies(author, permlink)).filter(({body, title, author}) => (body === nonce) && (author === this.username))
    return comments[0] ? comments[0].permlink : null
  }

  async receivePayment({permlink : last_permlink, buyer}){
    while (last_permlink){
      last_permlink = await this.waitForActiveVote({author : this.username, permlink : last_permlink, nonce, voter : buyer})
      last_author = this.username
    }
  }

  async getActiveVotes({voter, author = this.username, permlink}){
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

  async waitForActiveVote({author = this.username, permlink, voter}){
    do {
      const votes = await this.hasActiveVotes({voter, author, permlink})
      if (votes.length) return votes[0]
    } while(await wait(1000))
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