const { Bot } = require('./steempay_client.js')
const steemconnect = require('sc2-sdk')

class BrowserBot extends Client {
  constuctor(options) {
    super(options)
  }

  getTokenFromLocalStorage() {

    const access_token = localStorage.getItem('access_token')
    const username = localStorage.getItem('username')
    const expires_at = localStorage.getItem('expires_at') || 0

    if (expires_at < (Date.now() - 60 * 60 * 1000 * 24)) {
      return null
    }

    return {
      access_token,
      username,
      expires_at
    }

  }

  getTokenFromURL() {
    const searchparams = new URLSearchParams(document.location.search)
    const access_token = searchparams.get('access_token')
    const username = searchparams.get('username')
    const expires_at = (searchparams.get('expires_in') || 0) + Date.now()

    if (expires_at < (Date.now() - 60 * 60 * 1000 * 24)) {
      return null
    }

    localStorage.setItem('access_token', access_token)
    localStorage.setItem('username', username)
    localStorage.setItem('expires_at', expires_at)

    return {
      access_token,
      username,
      expires_at
    }
  }

  replaceAPI() {
    const options = { ...this._api.options, callbackURL: location.href },
    this._api = steemconnect.Initialize(options)
  }

  login() {
    const a = document.createElement('a')
    a.setAttribute('href', this._api.getLoginURL())
    document.body.appendChild(a)
    a.click()
  }

  initSteemConnect() {
    const creds = this.getTokenFromLocalStorage() || this.getTokenFromURL()
    if (creds) {
      const { access_token, username } = creds
      this.username
      this._api.setAccessToken(access_token)
    } else {
      this.login()
    }
  }

  async init() {
    this.initSteemConnect()
    await super.init()
  }
}

class Call {
  constructor({ iceServer, localVideo, remoteVideo }) {

  }

  start(isCaller) {

    let [protocol, hostname, port] = this.iceServer.urls.split(':')
    hostname = '//' + hostname
    protocol = 'wss'
    port = Number.parseInt(port) + 1
    const signaladdress = [protocol, hostname, port].join(':')


    this.start(true)
    var constraints = {
      video: true,
      audio: true,
    };

    const stream = navigator.mediaDevices.getUserMedia(constraints)

    this.localStream = stream;
    this.localVideo.srcObject = stream;

    this.serverConnection = new WebSocket(signaladdress);
    this.serverConnection.onmessage = (msg) => this.gotMessageFromServer(msg);

    this.peerConnection = new RTCPeerConnection({
      iceServers: [this.iceServer]
    });
    this.peerConnection.onicecandidate = (evt) => this.gotIceCandidate(evt);
    this.peerConnection.ontrack = (evt) => this.gotRemoteStream(evt);
    this.peerConnection.addStream(this.localStream);

    if (isCaller) {
      const offer = await peerConnection.createOffer()
      this.createdDescription(offer)
    }
  }

  gotMessageFromServer(message) {

    var signal = JSON.parse(message.data);

    if (signal.sdp) {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp))
      // Only create answers in response to offers
      if (signal.sdp.type == 'offer') {
        const description = await peerConnection.createAnswer()

        await this.peerConnection.setLocalDescription(description)

        this.serverConnection.send(JSON.stringify({ 'sdp': this.peerConnection.localDescription }));
      }
    } else if (signal.ice) {
      const candidate = new RTCIceCandidate(signal.ice)
      this.peerConnection.addIceCandidate(candidate).catch(errorHandler);
    }
  }

  gotIceCandidate(event) {
    if (event.candidate != null) {
      this.serverConnection.send(JSON.stringify({ 'ice': event.candidate }));
    }
  }

  gotRemoteStream(event) {
    console.log('got remote stream');
    this.remoteVideo.srcObject = event.streams[0];
  }

}

class SturnClient {
  constructor({ localVideo, remoteVideo, ringer, steempay }) {
    this.localVideo = localVideo
    this.remoteVideo = remoteVideo
    this.bot = new BrowserBot({
      ...steempay,
      services: [
        {
          name: 'Sturn Call',
          permlink: 'steempay-service-call',
          provider: async (user, service) => {
            const accept = await ringer(user)
            const credential = this.sturnCredentials.shift()
            this.call = new Call({ iceServer: credential.iceServer, localVideo, remoteVideo })
            this.call.start()
            return credential.service
          }
        }
      ]
    })

    this.sturnCredentials = []
  }

  async init() {

  }

  async start() {

  }

  async call(username) {
    const callservice = {
      username,
      service_permlink: 'steempay-service-call'
    }
    const sturn_service = await this.purchase(callservice)
    const iceServer = await this.purchase(sturn_service)

    this.call = new Call({
      iceServer,
      localVideo: this.localVideo,
      remoteVideo: this.remoteVideo
    })

    this.call.start(true)
  }

}

