const assert = require('assert')
const request = require('request-promise-native')
const crypto = require('crypto')
const steem = require('steem')
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

  it('gets .me', async() => {
    return 
    const me = await this.user1.me()
    assert(me)
    console.log(me)
  })

  it('sends encrypted message', async () => {
    return
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
    return 
    try {
      const advertisement = await this.user1.postAdvertisement({body : "hello world service"})
      console.log("POSTED ADVERTISEMENT")
  
      this.user1.provideService({
        advertisement,
        provider : (request) => {
          console.log("GOT PROVIDER REQUEST", request)
          return "HELLO DELIVERY"
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
      assert(delivery[0].body === "HELLO DELIVERY")
    } catch (e){
      console.log(e)
      throw e
    }
  })

  it('service flow', async () => {
    const advertisement = await this.user1.postAdvertisement()
    const seller = this.user1.username
    const order = await this.user2.placeOrder({
      seller,
      permlink : advertisement.permlink
    })

    const paid_orders = await this.user1.getNewPaidOrders(advertisement)
    console.log("PAID ORDERS",paid_orders)
    assert(paid_orders.length === 1)
    await this.user1.fulfillOrder({order : paid_orders[0], payload: 'HELLO ORDER'})
    const delivery = await this.user2.receiveDelivery({seller, order})
    assert(delivery.body === 'HELLO ORDER')
  })

  it('generates hotsigning link', () => {
    console.log(this.user1.transfer(this.user2.username, '0.001', 'hello world'))
  })

  it('detects follow', async () => {
    return;
    try {
      await this.user2.getNewFollowers()
      await this.user1.follow(this.user1.username, this.user2.username)
      const newfollowers = await this.user2.getNewFollowers()
      console.log(newfollowers)
      await this.user1.unfollow(this.user1.username, this.user2.username)
    } catch (e){
      console.log(e)
    }
  })

  it('updates comment without rate-limit', async () => {
    return
    const body = 'first line'
    const permlink = await this.user1.post({
      title : 'Test comment',
      body,
    })
    await this.user1.post({
      permlink,
      title : 'Test Update Comment',
      body : body + '\nsecond line'
    })
    const comment = await this.user2.getPost({
      author : this.user1.username,
      permlink
    })
    console.log(comment)
    assert(comment.body === 'first line\nsecond line')
  })

  it('multi votes', async () => {
    try {
      const body = 'first line'
      const permlink = await this.user1.post({
        permlink : '0455c88f3542d1870913a99e1370ecd9709e6c0a5ecafb694bb0aeccac4f1e80',
        title : 'Test comment',
        body,
      })
  
      await this.user2.vote(this.user2.username, this.user1.username, permlink, 10000)
      await this.user2.vote(this.user2.username, this.user1.username, permlink, 9900)
  
      const votes = await this.user1.getActiveVotes({
        voter : this.user2.username,
        permlink
      })
  
      assert(votes.length === 2)
    } catch (E){
      console.log(E)
      throw E
    }


  })

})