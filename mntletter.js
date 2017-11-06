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

var templates = {
  "header.html": function(){return ""},
  "footer.html": function(){return ""},

  "index.html": false,
  
  "list_join.html": false,
  "list_confirm_thanks.html": false,
  "list_subscribe_thanks.html": false,
  "list_subscribe_mail.txt": false,
  "list_unsubscribe_thanks.html": false,
  
  "mailings_new.html": false,
  "mailings_stage.html": false,
  "mailings_sent.html": false,
  
  "error_confirm_invalid.html": false,
  "error_invalid_list.html": false,
  "error_subscribe_invalid_email.html": false,
  "error_too_many_subscriptions.html": false,
  "error_unsubscribe_invalid.html": false
}

function initTemplates() {
  let keys = Object.keys(templates)
  for (var i=0; i<keys.length; i++) {
    k = keys[i]
    content = fs.readFileSync("./templates/"+k)
    templates[k] = dot.template(content, null, {
      header: templates["header.html"](),
      footer: templates["footer.html"]()
    })
    console.log("loaded: ",k)
  }
  templates["signature.txt"] = dot.template(CONFIG.emailSignature)
}

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

app.get('/', function(req, res) {
  let lists = Object.keys(DB.lists).map(function(k) {
    let l = DB.lists[k]
    return {
      name: l.name,
      title: l.title
    }
  })
  
  res.send(templates["index.html"]({
    lists: lists
  }))
})

app.get('/lists/:list/join', function (req, res) {
  let list = DB.lists[req.params["list"]]
  if (!list) {
    res.status(404).send(templates["error_invalid_list.html"]())
    return
  } else {
    res.send(templates["list_join.html"]({
      listTitle: list.title
    }))
  }
})

app.get('/lists/:list/subscribe', function (req, res) {
  let email = req.query["email"]
  let list = DB.lists[req.params["list"]]
  if (!list) {
    res.status(404).send(templates["error_invalid_list.html"]())
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
      res.send(templates["list_subscribe_thanks.html"]({
        listTitle: list.title
      }))
      
      let body = templates["list_subscribe_mail.txt"]({
        listTitle: list.title,
        link: link,
      })
      body += "\r\n"+templates["signature.txt"]({
        list: list.name,
        email: email,
        baseUrl: CONFIG.baseUrl
      })
      
      sendEmail(email, "["+list.name+"] Please confirm your subscription", body)
    } else {
      res.status(400).send(templates["error_too_many_subscriptions.html"]())
    }
  } else {
    res.status(400).send(templates["error_subscribe_invalid_email.html"]())
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
    res.send(templates["list_confirm_thanks.html"]())
  } else {
    res.status(400).send(templates["error_subscribe_invalid_email.html"]())
  }
})

app.get('/lists/:list/unsubscribe', function (req, res) {
  let email = req.query["email"]
  let list = DB.lists[req.params["list"]]
  if (!list) {
    res.status(404).send(templates["error_invalid_list.html"]())
    return
  } else if (emailValidator.validate(email) && list.subscribers[email]) {
    delete list.subscribers[email]
    saveDB()
    res.send(templates["list_unsubscribe_thanks.html"]())
  } else {
    res.status(400).send(templates["error_unsubscribe_invalid.html"]())
  }
})

app.get('/lists/:list/mailings/new', authMiddleware, function (req, res) {
  let list = DB.lists[req.params["list"]]
  if (!list) {
    res.status(404).send(templates["error_invalid_list.html"]())
    return
  } else {
    res.send(templates["mailings_new.html"]({
      listName: list.name
    }))
  }
})

app.post('/lists/:list/mailings/stage', authMiddleware, function (req, res) {
  let list = DB.lists[req.params["list"]]
  if (!list) {
    res.status(404).send(templates["error_invalid_list.html"]())
    return
  } else {
    let mailingId = req.body.id
    let subject = req.body.subject
    let body = req.body.body
    let numSubscribers = Object.keys(list.subscribers).length

    res.send(templates["mailings_stage.html"]({
      subject: subject,
      body: body,
      numSubscribers: numSubscribers,
      mailingId: mailingId
    }))

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
    res.status(404).send(templates["error_invalid_list.html"]())
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
        let fullBody = body+" "+templates["signature.txt"]({
          list: list.name,
          email: email,
          baseUrl: CONFIG.baseUrl
        })
        sendEmail(email, "["+list.name+"] "+subject, fullBody)
      }
      res.send(templates["mailings_sent.html"]({
        mailingId: mailingId,
        numSubscribers: numSubscribers
      }))
    }
  }
})

// launch ========================================================

initTemplates()
app.listen(CONFIG.port, function () {
  console.log('mntletter listening on '+CONFIG.port+'.')
  loadDB()
})
