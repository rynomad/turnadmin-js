const https = require('https')
const url = require('url')
const {EventEmitter} = require('events')
const fs = require('fs')

class TokenReceiver extends EventEmitter{
  constructor({username, credentials, certpath, keypath}){
    this.username = username
    this.credentials = credentials

    if (!this.token){
      this.server = https.createServer({
        cert : fs.readFileSync(certpath),
        key : fs.readFileSync(keypath)
      },(request, response) => {
        const {query : {access_token, expires_in, username}} = url.parse(request.url, true)
        if (access_token && expires_in && username) {
          console.log("GOT CREDENTIALS")
          console.log(access_token, expires_in, username)
          if (username !== this.username){
            console.warn('got wrong username, dropping')
            response.statusCode = 500
            response.statusMessage = "Bad Request"
            response.end()
            return
          }

          this.credentials = {access_token, expires_in, username}

          response.statusCode = 200
          response.end(() => {
            this.server.close(() => {
              this.emit('credentials', this.credentials)
            })
          })

        } else {
          console.log("got bad request",{access_token, expires_in, username})
          response.statusCode = 500
          response.statusMessage = "Bad Request"
          response.end()
        }
      })

      this.server.listen(4443)
    }
  }
}

module.exports = TokenReceiver