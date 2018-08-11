const crypto = require('crypto')
const steem = require('steem')
const fs = require('fs')
const https = require('https')
const url = require('url')
const request = require('request')
const Client = require('./steempay_client.js')
const STEEMPAY_DELIVERIES_PERMLINK = 'steempay-deliveries'




class Bot extends Client{
  constructor(
    options
  ){
    super(options)
  }

  async init(skiplisten){
    if (!(this._json.sc2.app && this._json.sc2.secret)){
      throw new Error("Bot requires sc2 config to have app and secret defined")
    } 

    if (skiplisten){
      if (!this._json.sc2.code){
        console.log('no code; listening')
        console.log(`visit ${this._api.getLoginURL()}&response_type=code to provision`)
        await this.listenForCode()
      }
  
      if (!this._json.sc2.refresh_token){
        await this.requestToken()
      }
  
      await this.refreshToken()
    }

    await super.init()
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
  Bot
}

