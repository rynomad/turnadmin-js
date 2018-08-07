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

const wait = (ms) => new Promise((resolve) => setTimeout(() => resolve(true), ms))

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
    await this.postPublicKey()
  }

  async postPublicKey(){
    await this.post({
      permlink : 'steempay-public-key',
      title : 'Public Key',
      body : this._keypair.publicKey.toString('hex')
    })
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

  async reply({author, permlink, reply : {title = 'reply', body = 'body', meta}}){
    try {
      const reply_permlink = crypto.randomBytes(32).toString('hex')
      await this.comment(author, permlink, this.username, reply_permlink, title, body, meta || null)
      return reply_permlink
    } catch (e) {
      console.warn(e)
      if (e.error_description.indexOf('STEEM_MIN_REPLY_INTERVAL') >= 0){
        console.log("waiting 22 seconds to retry")
        await wait(22 * 1000)
        return this.reply({author, permlink, reply : {title, body, meta}})
      }
    }
  }

  async getPost({author, permlink}){
    return new Promise((resolve, reject) => {
      steem.api.getContent(author, permlink, (err, res) => err ? reject(err) : resolve(res));
    })
  }

  async getUserPublicKey(user){
    //if (this._pubkeys.has(user)) return this._pubkeys.get(user)

    const post = await this.getPost({
      author : user,
      permlink : 'steempay-public-key'
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

  async replyEncrypted({author, permlink, reply : {title, body}}) {
    const pubkey = await this.getUserPublicKey(author)
    console.log(pubkey, pubkey.size, pubkey)
    const nonce = crypto.randomBytes(24)
    const box = Buffer.from(nacl.box(
      bufToUint(Buffer.from(body)), 
      bufToUint(nonce), 
      bufToUint(pubkey), 
      bufToUint(this._keypair.secretKey)
    )).toString('hex')

    const reply_permlink = nonce.toString('hex')
    await this.comment(author, permlink, this.username, reply_permlink, title, box, {"encrypted" : pubkey.toString('hex')})
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
    return Buffer.from(nacl.box.open(box, nonce, pubkey, bufToUint(this._keypair.secretKey) )).toString()
  }

  async placeOrder({author, advertisement : permlink}){
    return this.reply({
      author,
      permlink,
      reply : {
        title : 'ORDER'
      }
    })
  }

  async receiveInvoice({permlink : last_permlink, seller}){
    const invoice = []
    let done = false
    let last_author = this.username

    do {
      console.log("get invoice", last_author, last_permlink)
      const invoice_comment = await this.waitForInvoiceComment({
        author : last_author, 
        permlink : last_permlink,
        seller
      })
      last_author = invoice_comment.author
      last_permlink = invoice_comment.permlink
      console.log("invoice_comment", invoice_comment)
      done = !!(invoice_comment.json_metadata)
      invoice.push(invoice_comment)
    } while (!done)

    return invoice
  }

  async waitForInvoiceComment({author, permlink, seller}){
    do {
      console.log("poll replies for invoice comment", author, permlink, seller)
      const comments = await this.getReplies({
        author,
        permlink,
        commentor : seller,
        title : 'INVOICE'
      })

      if (comments[0]){
        return comments[0]
      }
    } while (await wait(1000))
  }

  async payInvoice({seller, invoice}){
    for (let {permlink} of invoice){
      console.log("pay invoice", seller, invoice, permlink)
      await this.vote(this.username, seller, permlink, 10000)
    }
  }

  async receiveDelivery({seller, order}){
    do {
      return this.getEncryptedReplies({
        author : this.username,
        permlink : order,
        commentor : seller,
        title : 'DELIVERY'
      })
    } while(await wait(1000))
  }

  async provideService({advertisement, provider, cost}){
    const seen = new Set()
    
    do {
      const new_orders = await this.receiveOrders({seen, advertisement})
      for (let order of new_orders){
        console.log('fulfill order',order )
        this.fulfillOrder({order, provider, cost}).catch(e => {
          console.error(e)
        })
      }
    } while(await wait(1000)) 
  }

  async postAdvertisement({permlink, body, meta}){
    return this.post({
      permlink,
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
          console.log("got new order", order)
          seen.add(order)
          new_orders.push({order, title, buyer : author})
        }
      }

      if (new_orders.length) return new_orders

    } while(await wait(1000))
  }

  async fulfillOrder({order : {order, buyer}, provider, cost}){
    console.log("fulfil order", order, buyer)
    const permlink = await this.postInvoice({
      author : buyer,
      order,
      quantity : cost
    })
    console.log("POSTED INVOICE")

    await this.receivePayment({
      permlink,
      buyer,
    })

    console.log("RECEIVED PAYMENT")

    const delivery = await provider({buyer})

    await this.sendDelivery({
      order,
      buyer,
      payload : delivery
    })
    console.log("SENT DELIVERY")
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

  async getNextInvoiceComment({author, nonce, permlink}){
    const comments = (await this.getContentReplies(author, permlink)).filter(({body, title, author}) => (body === nonce) && (author === this.username))
    return comments[0] ? comments[0].permlink : null
  }

  async receivePayment({permlink : last_permlink, buyer}){
    while (last_permlink){
      last_permlink = await this.waitForActiveVote({author : this.username, permlink : last_permlink, voter : buyer})
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
      const votes = await this.getActiveVotes({voter, author, permlink})
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

module.exports = SteemPay