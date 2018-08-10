const crypto = require('crypto')
const steem = require('steem')
const fs = require('fs')
const https = require('https')
const url = require('url')
const request = require('request')
const Client = require('./steempay_client.js')
const STEEMPAY_DELIVERIES_PERMLINK = 'steempay-deliveries'

class Service {
  constructor(
    bot,
    provider = (username) => username,
    {
      title = 'Echo',
      description = 'echo_service',
      tags = [],
      terms = { cost : 1},
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
      permlink : this.permlink,
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
    console.log("postServiceDefinition", this.service_definition)
    try {
      this.permlink = await this.bot.reply({
        author : this.bot.username,
        permlink : 'steempay-services',
        reply : this.service_definition
      })
    } catch (e){
      console.error(e)
      throw e
    }

    console.log("service_permlink", this.permlink)
  }

  async prepareSession(session_permlink){
    const session_service_permlink = `${session_permlink}-${this.permlink}`
    console.log("service.prepareSession", session_permlink)
    
    await this.bot.reply({
      author : this.bot.username,
      permlink : session_permlink,
      reply : {
        permlink : session_service_permlink,
        title : this.permlink,
        body : this.permlink
      }
    })

    console.log("SESSION_SERV_PERM", session_service_permlink)

    const votables = []

    for (let i = 0; i < this.terms.cost; i++){
      votables.push(await this.bot.reply({
        author : this.bot.username,
        permlink : session_service_permlink,
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
        console.log("fulfill order from", buyer)
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
    const votes = await this.getActiveVotes({
      author : this.bot.username,
      permlink : this.session_service_permlink
    })
    const new_orders = votes.map(({voter}) => voter).filter(voter => !this.orders.has(voter))

    let paid_orders = []

    for (let voter of new_orders){
      const paid = (await Promise.all(this.votables.map((permlink) => this.getActiveVotes({
        author : this.bot.username,
        permlink,
        voter
      })))).reduce((_paid, _votes) => _paid && _votes.length, true)
      
      if (paid){
        this.orders.add(voter)
        paid_orders.push(voter)
      }
    }

    return paid_orders
  }

  async getActiveVotes({author, permlink, voter}){
    return new Promise((resolve, reject) => {
      steem.api.getActiveVotes(author, permlink, (err, res) => {
        if (err){
          return reject(err)
        }
        resolve(res.filter(({voter: _voter}) => !voter || (voter === _voter)))
      })
    })
  }

  async fulfillOrder(buyer){
    const body = await this.provider(buyer)

    return this.bot.replyEncrypted({
      priority : true,
      author : buyer,
      permlink : STEEMPAY_DELIVERIES_PERMLINK,
      reply : {
        title : `DELIVERY-${this.session_service_permlink}`,
        body,
      }
    })
  }
}


class Bot extends Client{
  constructor(
    options
  ){
    super(options)

    this.services = options.services.map((service) => new Service(this, service.provider, service.config))
  }

  async init(){
    if (!(this._json.sc2.app && this._json.sc2.secret)){
      throw new Error("Bot requires sc2 config to have app and secret defined")
    }

    if (!this._json.sc2.code){
      console.log('no code; listening')
      console.log(`visit ${this._api.getLoginURL()}&response_type=code to provision`)
      await this.listenForCode()
    }

    if (!this._json.sc2.refresh_token){
      await this.requestToken()
    }

    await this.refreshToken()

    await super.init()

    for (let service of this.services){
      await service.init()
    }

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
      console.log("REDO SESSION", this.started, this.stopping)
      await this.newSession()
    } while (await this.waitStarted(1000))

    this.stopping = false
  }

  async stop(){
    this.started = false
    this.stopping = true

    for (let service of this.services){
      await service.stop()
    }

    while (await this.waitStopping(1000)){}
  }

  async newSession(){
    console.log("new session, prev:", this.permlink)
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

    console.log("new session permlink:", session_permlink)

    const services = new Map()

    for (let service of this.services){
      console.log("service preparing new permlink", service.permlink)
      const {session_service_permlink, votables} = await service.prepareSession(session_permlink)
      console.log("prepared at", session_service_permlink, votables)
      services.set(service.permlink, {session_service_permlink, votables})
    }

    console.log('update root body to point to session_permlink', session_permlink)
    await this.post({
      permlink : 'steempay-root',
      title : 'Root',
      body : session_permlink
    })


    for (let service of this.services){
      const {session_service_permlink, votables} = services.get(service.permlink)
      console.log('update session', session_permlink, session_service_permlink, votables)
      service.updateSession({
        session_permlink,
        session_service_permlink,
        votables
      })
    }
  }

  async consumeToken({access_token, refresh_token, expires_in, username}){
    if (access_token && (!this._json.username || (username === this._json.username)) && expires_in && refresh_token){
      this.username = username
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
          this.emit('update')
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
          this.emit('update')
          resolve()
        }
      )
    })
  }

  async listenForCode(){
    return new Promise((resolve, reject) => {
      this.server = https.createServer({
        cert : fs.readFileSync(this._json.sc2.certfile),
        key : fs.readFileSync(this._json.sc2.keyfile)
      },(request, response) => {
        const {query : {code}} = url.parse(request.url, true)
        console.log('got query', code)
        if (code) {
          this._json.sc2.code = code
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

