const https = require('https')
const url = require('url')
const {EventEmitter} = require('events')
const fs = require('fs')
const request = require('request')

class TokenManager extends EventEmitter{
  constructor({username, code, secretpath, certpath, keypath}){
    super()
    this.username = username
    this.code = code
    this.secret = fs.readFileSync(secretpath).toString().trim()
    this.cert = fs.readFileSync(certpath)
    this.key = fs.readFileSync(keypath)

    if (this.code){
      this.requestToken()
    } else {
      this.listenForCode()
    }
  }

  async refreshToken(){
    console.log("requesting refresh", this.refresh_token)
    return new Promise((resolve, reject) => {
      request.get(
        `https://steemconnect.com/api/oauth2/token?refresh_token=${this.refresh_token}&code=${this.code}`,
        (err, res, body) => {
          console.log("REFRESH RES", body)
        }
      )
    })
  }

  async requestToken(){
    console.log("requesting token ", this.code, this.secret)
    return new Promise((resolve, reject) => {
      request.get(
        `https://steemconnect.com/api/oauth2/token?code=${this.code}&client_secret=${this.secret}`,
        (err,res, {access_token, username, expires_in, refresh_token, ...body}) => {
          if (access_token && (username === this.username) && expires_in && refresh_token){
            this.access_token = access_token
            this.expires_at = Date.now() + (expires_in * 1000)
            this.refresh_token = refresh_token
            resolve()
          } else {
            reject(body)
          }
          console.log("GOT RES", err, body)
        }
      )
    })
  }

  listenForCode(){
    this.server = https.createServer({
      cert : this.cert,
      key : this.key
    },(request, response) => {
      const {query : {code}} = url.parse(request.url, true)
      console.log('got query', code)
      if (code) {
        this.code = code
        this.requestToken(code)
        response.statusCode = 200
        response.end()
      } else {
        response.statusCode = 500
        response.statusMessage = "Bad Request"
        response.end()
      }
    })

    this.server.listen(4443)
  }
}

module.exports = TokenManager
