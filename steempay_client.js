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

class Service {
  constructor(
    bot,
    provider = (username) => username,
    {
      title = 'Echo',
      description = 'echo_service',
      tags = [],
      terms = { cost: 1 },
      permlink = crypto.randomBytes(16).toString('hex')
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

  get json() {
    return {
      title: this.title,
      description: this.description,
      tags: this.tags.slice(1),
      terms: this.terms,
      permlink: this.permlink
    }
  }

  get meta() {
    return {
      tags: this.tags,
      terms: this.terms
    }
  }

  get service_definition() {
    return {
      permlink: this.permlink,
      title: this.title,
      body: this.description,
      meta: this.meta
    }
  }

  async init() {
    await this.postServiceDefinition()
  }

  updateSession({ session_permlink, session_service_permlink, votables }) {
    this.session_permlink = session_permlink
    this.session_service_permlink = session_service_permlink
    this.votables = votables
    this.orders = new Set()
  }

  async postServiceDefinition() {
    console.log("postServiceDefinition", this.service_definition)
    const service_definition = await this.bot.getPost({
      author: this.bot.username,
      permlink: this.permlink
    })
    if (!service_definition) {
      this.permlink = await this.bot.reply({
        author: this.bot.username,
        permlink: 'steempay-services',
        reply: this.service_definition
      })
    }

  }

  async prepareSession(session_permlink) {
    const session_service_permlink = `${session_permlink}-${this.permlink}`
    console.log("service.prepareSession", session_permlink)

    await this.bot.reply({
      author: this.bot.username,
      permlink: session_permlink,
      reply: {
        permlink: session_service_permlink,
        title: this.permlink,
        body: this.permlink
      }
    })

    console.log("SESSION_SERV_PERM", session_service_permlink)

    const votables = []

    for (let i = 0; i < this.terms.cost; i++) {
      votables.push(await this.bot.reply({
        author: this.bot.username,
        permlink: session_service_permlink,
        reply: {
          title: this.permlink,
          body: this.permlink
        }
      }))
    }

    return { session_service_permlink, votables, permlink: this.permlink }
  }

  async waitStarted(ms) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.started), ms)
    })
  }

  async waitStopping(ms) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.stopping), ms)
    })
  }

  async start() {
    this.started = true

    do {
      const orders = await this.getNewPaidOrders()
      for (let buyer of orders) {
        console.log("fulfill order from", buyer)
        this.fulfillOrder(buyer)
      }
    } while (await this.waitStarted(100))

    this.stopping = false
  }

  async stop() {
    this.stopping = true
    this.started = false
    while (await this.waitStopping(100)) { }
  }

  async getNewPaidOrders() {
    if (!this.session_service_permlink) return []
    const votes = await this.getActiveVotes({
      author: this.bot.username,
      permlink: this.session_service_permlink
    })
    const new_orders = votes.map(({ voter }) => voter).filter(voter => !this.orders.has(voter))

    let paid_orders = []

    for (let voter of new_orders) {
      const paid = (await Promise.all(this.votables.map((permlink) => this.getActiveVotes({
        author: this.bot.username,
        permlink,
        voter
      })))).reduce((_paid, _votes) => _paid && _votes.length, true)

      if (paid) {
        this.orders.add(voter)
        paid_orders.push(voter)
      }
    }

    return paid_orders
  }

  async getActiveVotes({ author, permlink, voter }) {
    return new Promise((resolve, reject) => {
      steem.api.getActiveVotes(author, permlink, (err, res) => {
        if (err) {
          console.log('active votes failed', author, permlink)
          return reject(err)
        }
        resolve(res.filter(({ voter: _voter }) => !voter || (voter === _voter)))
      })
    })
  }

  async fulfillOrder(buyer) {
    const body = await this.provider(buyer, this)
    if (!body) return

    return this.bot.replyEncrypted({
      priority: true,
      author: buyer,
      permlink: STEEMPAY_DELIVERIES_PERMLINK,
      reply: {
        title: `DELIVERY-${this.session_service_permlink}`,
        body,
      }
    })
  }
}
class Client extends EventEmitter {

  constructor({
    sc2,
    username,
    services,
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

    this.services = services.map((service) => new Service(this, service.provider, service.config))
  }

  get api() {
    if (!this._api.options.accessToken) {
      console.error(this._api)
      throw new Error('cannot use api without access token')
    }
    return this._api
  }

  get loginURL() {
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

    for (let service of this.services) {
      await service.init()
    }

    await this.newSession()
  }

  async waitStarted(ms) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.started), ms)
    })
  }

  async waitStopping(ms) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(this.stopping), ms)
    })
  }

  async start() {
    this.started = true

    for (let service of this.services) {
      service.start().catch((e) => {
        console.log("service error")
        console.error(e)
      })
    }


    do {
      console.log("REDO SESSION", this.started, this.stopping)
      await this.newSession()
    } while (await this.waitStarted(60000))

    this.stopping = false
  }

  async stop() {
    this.started = false
    this.stopping = true

    for (let service of this.services) {
      await service.stop()
    }

    while (await this.waitStopping(100)) { }
  }

  async newSession() {
    console.log("new session, prev:", this.permlink)
    await this.reply({
      author: this.username,
      permlink: 'steempay-root',
      reply: {
        permlink: 'steempay-sessions',
        title: "Sessions",
        body: "sessions"
      }
    })

    const session_permlink = await this.reply({
      author: this.username,
      permlink: 'steempay-sessions',
      reply: {
        title: 'Session',
        body: 'session'
      }
    })

    console.log("new session permlink:", session_permlink)

    const services = new Map()

    for (let service of this.services) {
      console.log("service preparing new permlink", service.permlink)
      const { session_service_permlink, votables } = await service.prepareSession(session_permlink)
      console.log("prepared at", session_service_permlink, votables)
      services.set(service.permlink, { session_service_permlink, votables })
    }

    console.log('update root body to point to session_permlink', session_permlink)
    await this.post({
      permlink: 'steempay-root',
      title: 'Root',
      body: session_permlink
    })


    for (let service of this.services) {
      const { session_service_permlink, votables } = services.get(service.permlink)
      console.log('update session', session_permlink, session_service_permlink, votables)
      service.updateSession({
        session_permlink,
        session_service_permlink,
        votables
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
      jsonMetadata = jsonMetadata || {}
      jsonMetadata.tags = jsonMetadata.tags || []
      jsonMetadata.tags.push('steempay')
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

  async purchase({
    seller,
    service_permlink
  }) {
    const order = await this.placeOrder({
      seller,
      service_permlink
    })

    const delivery = await client.receiveDelivery({ seller: 'rynomad', order })
    const json = JSON.parse(delivery)
    return json
  }
}


module.exports = {
  Client,
  Service,
}