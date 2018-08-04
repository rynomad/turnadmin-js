
global.fetch = require('node-fetch')
const steemconnect = require('sc2-sdk')
const https = require('https')
const url = require('url')
const {EventEmitter} = require('events')
const fs = require('fs')
const request = require('request')
const DAY_MS = 1000 * 60 * 60 * 24

class TokenManager extends EventEmitter{
  static fromFile(filepath){
    const mgr = new TokenManager(JSON.parse(fs.readFileSync(filepath).toString().trim()))
    mgr.persist(filepath)
    return mgr
  }

  constructor({
    sc2,
    username, 
    certfile, 
    keyfile, 
    secret,
    code, 
    access_token, 
    refresh_token, 
    expires_at = 0,
    port
  }) {
    super()
    this._json = {
      sc2,
      username,
      code,
      secret,
      certfile,
      keyfile,
      access_token,
      refresh_token,
      expires_at,
      port
    }
  }

  get sc2_config(){
    return {accessToken : this._json.access_token, ...this._json.sc2}
  }

  get serialize(){
    return JSON.stringify(this._json, null, 4)
  }

  get api(){
    if (!this._api) throw new Error('must call init() before accessing api')
    return this._api
  }

  persist(filepath){
    this.on('update', () => {
      fs.writeFileSync(filepath, this.serialize)
    })
  }

  async init(){
    if (!this._json.code){
      console.log('no code; listening')
      await this.listenForCode()
    }

    if (!this._json.access_token){
      console.log('no access_token; requesting')
      await this.requestToken()
    }

    console.log("maybeRefresh")
    await this.maybeRefreshToken()

    this._api = steemconnect.Initialize(this.sc2_config)
  }

  async maybeRefreshToken(){
    if (this._json.expires_at < (Date.now() + DAY_MS)){
      await this.refreshToken()
    }
  }

  async consumeToken({access_token, refresh_token, expires_in, username}){
    if (access_token && (username === this._json.username) && expires_in && refresh_token){
      this._json.access_token = access_token
      this._json.expires_at = Date.now() + (expires_in * 1000)
      this._json.refresh_token = refresh_token
      this.emit('update')
      return true
    }

    return false
  }

  async refreshToken(){
    console.log("requesting refresh", this.refresh_token)
    return new Promise((resolve, reject) => {
      request.get(
        `https://steemconnect.com/api/oauth2/token?refresh_token=${this._json.refresh_token}&grant_type=refresh_token&client_secret=${this._json.secret}`,
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
        `https://steemconnect.com/api/oauth2/token?code=${this._json.code}&client_secret=${this._json.secret}`,
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

module.exports = TokenManager

if (require.main === module){
  const filepath = process.argv.pop()
  const mgr = TokenManager.fromFile(filepath)
  mgr.init().then(res => {
    console.log("token manager up", mgr.serialize)
    mgr.api.me((err, res) => {
      console.log(err, res)
    })
  }).catch(e => {
    console.error(e)
  })
}

