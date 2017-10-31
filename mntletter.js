const express = require('express')
const bodyParser = require('body-parser')
const RateLimit = require('express-rate-limit')
const auth = require('http-auth')
const mv = require('mv')
const md5 = require('md5')
const fs = require('fs')
const sendmail = require('sendmail')()
const emailValidator = require('email-validator')
const dot = require('dot')
dot.templateSettings.strip = false

const dbPath = "./db.json"
const CONFIG = JSON.parse(fs.readFileSync("./config.json"))

const limiter = new RateLimit({
  windowMs: 60*1000, // 1 minute
  delayAfter: 3,
  max: 20, // limit each IP to 20 requests per minute
})

const app = express()
app.use(limiter)
app.use(bodyParser.urlencoded({ extended: false }))

var authMiddleware = auth.connect(auth.basic({
  realm: 'List Admin'
}, function(username, password, callback) {
  callback(username == CONFIG.adminEmail && password == CONFIG.adminPassword);
}))

var DB = {}
var confirmationRequests = {}

function loadDB() {
  DB = JSON.parse(fs.readFileSync(dbPath))
  console.log("DB loaded.")
}

function saveDB() {
  fs.copyFileSync(dbPath, dbPath+".old")
  fs.writeFileSync(dbPath+".new", JSON.stringify(DB))
  fs.copyFileSync(dbPath+".new", dbPath)
}

function confirmCode(email) {
  return md5(email+CONFIG.confirmSecret)
}

function sendEmail(to, subject, body) {
  console.log("sendEmail to:",to)
  console.log("sendEmail subject:",subject)
  console.log("sendEmail body:",body)
  sendmail({
    from: CONFIG.adminEmail,
    to: to,
    subject: subject,
    text: body,
  }, function(err, reply) {
    console.error("sendEmail error: ", err && err.stack)
    console.dir(reply)
  })
}

app.get('/lists/:list/join', function (req, res) {
  let list = DB.lists[req.params["list"]]
  if (list) {
    res.send('<html><h1>Subscribe to email updates</h1><form action="subscribe" method="GET"><label>Your email address: <input name="email" type="email"> <input type="submit" value="subscribe"></form></html>')
  } else {
    res.status(404).send("Invalid list.")
  }
})

app.get('/lists/:list/subscribe', function (req, res) {
  let email = req.query["email"]
  let list = DB.lists[req.params["list"]]
  if (!list) {
    res.status(404).send("Invalid list.")
    return
  } else if (emailValidator.validate(email) && !list.subscribers[email]) {
    if (!confirmationRequests[email]) {
      confirmationRequests[email] = 1
    } else {
      confirmationRequests[email]++
    }
    // prevent abuse of subscribe function to spam someone
    if (confirmationRequests[email]<20) {
      let link = CONFIG.baseUrl+"/lists/"+list.name+"/confirm?email="+email+"&code="+confirmCode(email)
      res.send("Thanks for subscribing to "+list.title+". You will receive an email with a confirmation link. Please visit this link to confirm that you really want to subscribe.")
      
      let body = dot.template('Hello,\r\n\r\nFollow this link to confirm your subscription to '+list.title+':\r\n'+link+'\r\n\r\nIf you did not intentionally subscribe, please ignore this mail.\r\n\r\n'+CONFIG.emailSignature)({
        list: list.name,
        email: email,
        baseUrl: CONFIG.baseUrl
      })
      sendEmail(email, "["+list.name+"] Please confirm your subscription", body)
    } else {
      res.status(400).send("Too many subscription requests for this email address.")
    }
  } else {
    res.status(400).send("Please provide a valid email address that is not yet subscribed to this list.")
  }
})

// double opt-in
app.get('/lists/:list/confirm', function (req, res) {
  let email = req.query["email"]
  let list = DB.lists[req.params["list"]]
  let code = confirmCode(email)
  if (!list) {
    res.status(404).send("Invalid list.")
    return
  } else if (emailValidator.validate(email) && !list.subscribers[email] && confirmCode(email) == code) {
    list.subscribers[email] = {"subscribedAt":new Date().toISOString()}
    saveDB()
    res.send("Thanks for confirming your subscription. You will receive email updates until you opt out.")
  } else {
    res.status(400).send("Please provide a valid email address and confirmation code.")
  }
})

app.get('/lists/:list/unsubscribe', function (req, res) {
  let email = req.query["email"]
  let list = DB.lists[req.params["list"]]
  if (!list) {
    res.status(404).send("Invalid list.")
    return
  } else if (emailValidator.validate(email) && list.subscribers[email]) {
    delete list.subscribers[email]
    saveDB()
    res.send("Thanks for unsubscribing. You will receive no further emails.")
  } else {
    res.status(400).send("Please provide a valid email address that is subscribed to this list.")
  }
})

app.get('/lists/:list/mailings/new', authMiddleware, function (req, res) {
  let list = DB.lists[req.params["list"]]
  if (!list) {
    res.status(404).send("Invalid list.")
    return
  } else {
    res.send('<h1>New Mailing to '+list.name+'</h1><form action="./stage" method="POST"><label>ID: <input type="text" name="id"></label><label>Subject: <input type="text" name="subject" autofocus></label><br><textarea name="body" cols=80 rows=32></textarea><br><input type="submit" value="Preview"></form>')
  }
})

app.post('/lists/:list/mailings/stage', authMiddleware, function (req, res) {
  let list = DB.lists[req.params["list"]]
  if (!list) {
    res.status(404).send("Invalid list.")
    return
  } else {
    let mailingId = req.body.id
    let subject = req.body.subject
    let body = req.body.body
    let numSubscribers = Object.keys(list.subscribers).length

    res.send('<h1>Preview of mailing #'+mailingId+'</h1><pre>Subject: '+subject+'\r\n\r\n'+body+'</pre><br><br><form action="./'+mailingId+'/send" method="POST"><input type="submit" name="send" value="Send to '+numSubscribers+' subscribers!"></form>')

    if (!DB.mailings) DB.mailings = {}
    
    DB.mailings[mailingId] = {
      createdAt: new Date().toISOString(),
      subject: subject,
      body: body,
      numSubscribers: numSubscribers
    }
    saveDB()
    sendEmail(CONFIG.adminEmail, "["+list.name+"] (preview) "+subject, body)
  }
})

app.post('/lists/:list/mailings/:id/send', authMiddleware, function (req, res) {
  let list = DB.lists[req.params["list"]]
  if (!list) {
    res.status(404).send("Invalid list.")
    return
  } else {
    let mailingId = req.params.id
    if (!DB.mailings[mailingId]) {
      res.send('Mailing not found.')
    } else if (DB.mailings[mailingId].sentAt) {
      res.send('Mailing was already sent!')
    } else {
      let subject = DB.mailings[mailingId].subject
      let body = DB.mailings[mailingId].body
      let emails = Object.keys(list.subscribers)
      let numSubscribers = emails.length
      
      DB.mailings[mailingId].sentAt = new Date().toISOString()
      saveDB()
      for (var i=0; i<emails.length; i++) {
        let email = emails[i]
        console.log("send to ",email)
        let fullBody = body+" "+dot.template(CONFIG.emailSignature)({
          list: list.name,
          email: email,
          baseUrl: CONFIG.baseUrl
        })
        sendEmail(email, "["+list.name+"] "+subject, fullBody)
      }
      res.send('<h1>Mailing #'+mailingId+' Sent</h1>Mailing sent to '+numSubscribers+' subscribers.')
    }
  }
})

app.listen(CONFIG.port, function () {
  console.log('mntletter listening on '+CONFIG.port+'.')
  loadDB()
})
