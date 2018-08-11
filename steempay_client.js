const crypto = require('crypto')
const { EventEmitter } = require('events')
const steem = require("steem")
const sc2_sdk = require('sc2-sdk')
const nacl = require('tweetnacl')

const STEEMPAY_DELIVERIES_PERMLINK = 'steempay-deliveries'

function bufToUint(buf) {
  const uint = new Uint8Array(buf.byteLength)
  for (let i = 0; i < buf.byteLength; i++) {
    uint[i] = buf[i]
  }
  return uint
}

const sc2_cb = (op, resolve, reject, invalid_json_cb) => (err, res) => {
  if (err) {
    if (err.type === "invalid-json" && invalid_json_cb) return invalid_json_cb().then(resolve).catch(reject)
    return reject(err)
  }
  resolve(res)
}

const wait = (ms) => new Promise((resolve) => setTimeout(() => resolve(true), ms))

class Client extends EventEmitter {

  constructor({
    sc2,
    username,
    keypair = nacl.box.keyPair()
  }) {
    super()
    this._json = {
      sc2,
      username,
      keypair
    }
    this.username = username

    this._api = sc2_sdk.Initialize(sc2)
    this._keypair = {
      publicKey: Buffer.from(keypair.publicKey),
      secretKey: Buffer.from(keypair.secretKey)
    }

    this.fifo = []
  }

  get api() {
    if (!this._api.options.accessToken) {
      console.error(this._api)
      throw new Error('cannot use api without access token')
    }
    return this._api
  }

  get loginURL(){
    return this._api.getLoginURL()
  }

  setAccessToken(access_token) {
    this._api.setAccessToken(access_token)
  }

  async init() {

    const rootpost = await this.getPost({
      author: this.username,
      permlink: 'steempay-root'
    })
    if (!rootpost) {
      console.log("post client root")
      await this.post({
        permlink: 'steempay-root',
        title: "Root",
        body: 'init'
      })
    }

    const deliveries_post = await this.getPost({
      author: this.username,
      permlink: STEEMPAY_DELIVERIES_PERMLINK
    })

    if (!deliveries_post || (deliveries_post.body !== this._keypair.publicKey.toString('hex'))) {
      console.log("post client deliveries")
      await this.reply({
        author: this.username,
        permlink: 'steempay-root',
        reply: {
          permlink: STEEMPAY_DELIVERIES_PERMLINK,
          title: 'Deliveries',
          body: this._keypair.publicKey.toString('hex')
        }
      })
    }


    const services_post = await this.getPost({
      author: this.username,
      permlink: 'steempay-services'
    })

    if (!services_post) {
      console.log("post client services")
      await this.reply({
        author: this.username,
        permlink: 'steempay-root',
        reply: {
          permlink: 'steempay-services',
          title: 'Services',
          body: 'services'
        }
      })
    }
  }

  async me() {
    return new Promise((resolve, reject) => {
      this.api.me(sc2_cb('me'))
    })
  }

  async vote(voter, author, permlink, weight) {
    return new Promise((resolve, reject) => {
      console.log("vote", voter, author, permlink, weight)
      this.api.vote(voter, author, permlink, weight, sc2_cb('vote', resolve, reject, () => this.vote(voter, author, permlink, weight)))
    })
  }

  async __comment({ parentAuthor, parentPermlink, author, permlink, title, body, jsonMetadata }) {
    return new Promise((resolve, reject) => {
      this.api.comment(parentAuthor, parentPermlink, author, permlink, title, body, jsonMetadata,
        sc2_cb('comment', resolve, reject, (err) => this.__comment(parentAuthor, parentPermlink, author, permlink, title, body, jsonMetadata))
      )
    })
  }

  async _comment() {
    if (this._commenting) return
    this._commenting = true
    while (this.fifo.length) {
      const job = this.fifo.shift()
      try {
        job.promise.resolve(await this.__comment(job.args))
      } catch (e) {
        if (e.error_description && ((e.error_description.indexOf('STEEM_MIN_ROOT_COMMENT_INTERVAL') >= 0) || (e.error_description.indexOf('STEEM_MIN_REPLY_INTERVAL') >= 0))) {
          this.fifo.unshift(job)
        } else {
          job.promise.reject(e)
        }

      }
      await wait(1000)
    }
    this._commenting = false
  }

  async comment(parentAuthor, parentPermlink, author, permlink, title, body, jsonMetadata, priority) {
    return new Promise((resolve, reject) => {
      console.log("comment into fifo", parentAuthor, parentPermlink, author, permlink, title)
      let fifo_op = priority ? 'unshift' : 'push'
      this.fifo[fifo_op]({
        promise: {
          resolve,
          reject
        },
        args: {
          parentAuthor,
          parentPermlink,
          author,
          permlink,
          title,
          body,
          jsonMetadata
        }
      })
      this._comment()
    })
  }

  async revokeToken() {
    return new Promise((resolve, reject) => {
      this.api.revokeToken(sc2_cb('revokeToken', resolve, reject))
    })
  }

  async reblog(account, author, permlink) {
    return new Promise((resolve, reject) => {
      this.api.reblog(account, author, permlink, sc2_cb('reblog', resolve, reject))
    })
  }

  async follow(follower, following) {
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

  async updateUserMetadata(metadata) {
    return new Promise((resolve, reject) => {
      this.api.updateUserMetadata(metadata, sc2_cb('updateUserMetadata', resolve, reject))
    })
  }

  async post({ permlink = crypto.randomBytes(16).toString('hex'), title, body, meta }) {
    console.log(permlink, title, body, meta)
    try {
      await this.comment('', this.username, this.username, permlink, title, body, meta || null)
    } catch (e) {
      if (e.name === 'FetchError') return this.post({ permlink, title, body, meta })
      if (e.error_description.indexOf('STEEM_MIN_ROOT_COMMENT_INTERVAL') >= 0) {
        console.log("waiting 5 min 5 sec to retry")
        await wait(5 * 60 * 1000 + 5000)
        return this.post({ permlink, title, body, meta })
      } else {
        throw e
      }
    }
    return permlink
  }

  async reply({ priority, author, permlink, reply: { permlink: reply_permlink, title = 'reply', body = 'body', meta } }) {
    reply_permlink = reply_permlink || crypto.randomBytes(16).toString('hex')
    await this.comment(author, permlink, this.username, reply_permlink, title, body, meta || null, priority)
    return reply_permlink
  }

  async getPost({ author, permlink }) {
    return new Promise((resolve, reject) => {
      steem.api.getContent(author, permlink, (err, res) => {
        if (err) return reject(err)
        if (res.id) return resolve(res)
        resolve(null)
      });
    })
  }

  async getUserPublicKey(user) {
    const post = await this.getPost({
      author: user,
      permlink: STEEMPAY_DELIVERIES_PERMLINK
    })

    const pubkey = Buffer.from(post.body, 'hex')
    //this._pubkeys.set(user, pubkey)
    return pubkey
  }



  async getReplies({ author = this.username, permlink, commentor, title }) {
    return new Promise((resolve, reject) =>
      steem.api.getContentReplies(author, permlink, (err, res) =>
        err ? reject(err) : resolve(res.filter(
          ({ title: _title, author: _commentor }) =>
            (!commentor || (commentor === _commentor)) && (!title || (title === _title))
        )
        )
      )
    )
  }

  async replyEncrypted({ priority = false, author, permlink, pubkeyhex, reply: { permlink: reply_permlink, title, body } }) {
    let pubkey
    try {
      pubkey = Buffer.from(pubkeyhex, 'hex')
    } catch (e) {
      pubkey = await this.getUserPublicKey(author)
    }

    const nonce = crypto.randomBytes(24)
    const box = Buffer.from(nacl.box(
      bufToUint(Buffer.from(body)),
      bufToUint(nonce),
      bufToUint(pubkey),
      bufToUint(this._keypair.secretKey)
    )).toString('hex')

    console.log("ENCRYPTED REPLY", author, permlink, title, nonce, box)
    await this.reply({
      priority,
      author,
      permlink,
      reply: {
        permlink: nonce.toString('hex'),
        title,
        body: box,
        meta: { "encrypted": pubkey.toString('hex'), "nonce": nonce.toString('hex') }
      }
    })
    return reply_permlink
  }

  async getEncryptedReplies({ permlink, commentor, title }) {
    const replies = (await this.getReplies({ permlink, commentor, title })).filter(({ json_metadata }) => {
      console.log("FILTER", json_metadata)
      const meta = JSON.parse(json_metadata)

      console.log("meta", meta, this._keypair.publicKey.toString('hex'), (meta.encrypted === this._keypair.publicKey.toString('hex')))
      return (meta.encrypted === this._keypair.publicKey.toString('hex'))
    })

    if (!replies.length) return []
    console.log("got encrypted replies")
    const decrypted = []
    for (let reply of replies) {
      const { author, permlink, body } = reply
      const decrypted_body = await this.decryptBody({ author, permlink, body })

      decrypted.push({ ...reply, body: decrypted_body })
    }

    console.log(decrypted)
    return decrypted
  }

  async decryptBody({ author, permlink, body }) {
    console.log("decryptBody")
    const box = bufToUint(Buffer.from(body, 'hex'))
    const nonce = bufToUint(Buffer.from(permlink, 'hex'))
    const pubkey = bufToUint((await this.getUserPublicKey(author)))
    console.log("got uints")
    const decrypted = Buffer.from(nacl.box.open(box, nonce, pubkey, bufToUint(this._keypair.secretKey)))
    console.log("decrypted", decrypted)

    return Buffer.from(decrypted).toString()
  }

  async placeOrder({ seller: author, service_permlink }) {
    const { body: session_permlink } = await this.getPost({
      author,
      permlink: 'steempay-root'
    })

    const session_service_permlink = `${session_permlink}-${service_permlink}`

    const votables = (await this.getReplies({
      author,
      permlink: session_service_permlink,
      commentor: author
    })).map(({ permlink }) => permlink)

    await Promise.all(votables.map((permlink) => this.vote(this.username, author, permlink, 10000)))

    await this.vote(this.username, author, session_service_permlink, 10000)

    return session_service_permlink
  }

  async receiveDelivery({ seller, order }) {
    do {
      const deliveries = await this.getEncryptedReplies({
        author: this.username,
        permlink: STEEMPAY_DELIVERIES_PERMLINK,
        reply_permlink: `delivery-${order}`,
        commentor: seller,
        title: `DELIVERY-${order}`
      })
      if (deliveries.length) {
        console.log("got encrypted deleveries", deliveries[0].body)
        return deliveries[0]
      }
    } while (await wait(1000))
  }
}


module.exports = Client