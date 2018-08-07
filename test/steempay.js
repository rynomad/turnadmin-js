const assert = require('assert')
const request = require('request-promise-native')
const crypto = require('crypto')
const testdir = require('fs-jetpack').dir(__dirname)


const SteemPay = require('../steempay.js')

const randString = () => crypto.randomBytes(32).toString('hex')

describe('Steempay', function(){
  this.timeout(10 * 60 * 1000)
  before(async () => {
    const keys = testdir.read('keys.json', 'json')
    if (!keys){
      throw new Error(`Must run 'npm run get_test_keys'`)
    }

    const user1_tokens = JSON.parse(
      await request(`https://steemconnect.com/api/oauth2/token?refresh_token=${keys.user_one.refresh_token}&grant_type=refresh_token&client_secret=${keys.app_secret}`) 
    )
    const user2_tokens = JSON.parse(
      await request(`https://steemconnect.com/api/oauth2/token?refresh_token=${keys.user_two.refresh_token}&grant_type=refresh_token&client_secret=${keys.app_secret}`)
    )

    this.user1 = new SteemPay({
      username : user1_tokens.username,
      sc2 : {
        app : keys.app_name,
        callback_url : 'http://localhost:4000',
        accessToken : user1_tokens.access_token,
        scope : [
          'vote',
          'comment',
          'offline'
        ]
      }
    })

    this.user2 = new SteemPay({
      username : user2_tokens.username,
      sc2 : {
        app : keys.app_name,
        callbackURL : 'http://localhost:4000',
        accessToken : user2_tokens.access_token,
        scope : [
          'vote',
          'comment',
          'offline'
        ]
      }
    })
  })

  it('has two unique users for testing', async () => {
    assert(this.user1.username !== this.user2.username, `Must have two unique users to test flow, got '${this.user1.username}' and '${this.user2.username}'`)
  })

  it('generates keypair', () => {
    assert(this.user1._keypair.publicKey)
    assert(this.user2._keypair.publicKey)
  })

  it('initializes', async () => {
    
    await this.user1.init()
    await this.user2.init()

    const user1pub = await this.user2.getUserPublicKey(this.user1.username)
    const user2pub = await this.user1.getUserPublicKey(this.user2.username)
    console.log(user1pub.toString('hex'), user2pub.toString('hex'))
    console.log(this.user1._keypair.publicKey.toString('hex'), this.user2._keypair.publicKey.toString('hex'))

    assert(user1pub.toString('hex') === this.user1._keypair.publicKey.toString('hex'), 'user1 public keys not equal')
    assert(user2pub.toString('hex') === this.user2._keypair.publicKey.toString('hex'), 'user2 public keys not equal')
  })

  it('sends encrypted message', async () => {
    await this.user1.replyEncrypted({
      author : this.user2.username,
      permlink : 'steempay-public-key',
      reply : {
        title : 'TEST ENCRYPTED PAYLOAD',
        body : 'hello world'
      }
    })

    const reply = (await this.user2.getEncryptedReplies({
      permlink : 'steempay-public-key',
      commentor : this.user1.username,
      title : 'TEST ENCRYPTED PAYLOAD'
    }))[0]

    assert(reply)
    assert(reply.body === 'hello world')
  })

  it('provides service', async () => {
    try {
      const advertisement = await this.user1.postAdvertisement({body : "hello world service"})
      console.log("POSTED ADVERTISEMENT")
  
      this.user1.provideService({
        advertisement,
        provider : (request) => {
          console.log("GOT PROVIDER REQUEST", request)
        }
      }).catch(e => {
        console.log(e)
      })
  
      console.log("PROVIDING SERVICE")
  
      const order_permlink = await this.user2.placeOrder({
        author : this.user1.username,
        advertisement
      })
  
      console.log("PLACED ORDER", order_permlink)
  
      const invoice = await this.user2.receiveInvoice({
        permlink : order_permlink,
        seller : this.user1.username
      })
  
      console.log("GOT INVOICE", invoice)
  
      await this.user2.payInvoice({
        seller : this.user1.username,
        invoice
      })
  
      console.log("PAID INVOICE")
  
      const delivery = await this.user2.receiveDelivery({
        seller : this.user1.username,
        order : order_permlink
      })
  
      console.log("GOT DELIVERY", delivery)
    } catch (e){
      console.log(e)
      throw e
    }

  })

})