const https = require('https')
const url = require('url')
const {EventEmitter} = require('events')
const fs = require('fs')
const request = require('request')
const DAY_MS = 1000 * 60 * 60 * 24

class TokenManager extends EventEmitter{
  async static fromFile(filepath){
    const mgr = new TokenManager(JSON.parse(fs.readFileSync(jsonfile).toString().trim()))
    mgr.persist(filepath)
  }

  constructor({
    username, 
    certfile, 
    keyfile, 
    secret,
    code, 
    access_token, 
    refresh_token, 
    expires_at
  }) {
    super()
    this._json = {
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

  get serialize(){
    return JSON.stringify(this._json, null, 4)
  }

  persist(jsonfile){
    this.on('update', () => {
      fs.writeFileSync(jsonfile, this.serialize)
    })
  }

  async init(){
    if (!this._json.code){
      await this.listenForCode()
    }

    if (!this._json.access_token){
      await this.requestToken()
    }

    await this.maybeRefreshToken()
  }

  async maybeRefreshToken(){
    if (this._json.expires_at < (Date.now() + DAY_MS)){
      await this.refreshToken()
    }
  }

  async consumeToken({access_token, refresh_token, expires_in, username}){
    if (access_token && (username === this.username) && expires_in && refresh_token){
      this._json.access_token = access_token
      this._json.expires_at = Date.now() + (expires_in * 1000)
      this._json.refresh_token = refresh_token
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
    console.log("requesting token ", this.code, this.secret)
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
      this.server.listen(this._json.port || 4443)
    })


  }
}

module.exports = TokenManager

if (require.main === 'module'){
  const filepath = process.argv.pop()
  const mgr = TokenManager.fromFile(filepath)
  mgr.init().then(res => {
    console.log("token manager up", mgr.serialize)
  }).catch(e => {
    console.error(e)
  })
}
