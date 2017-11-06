# mntletter

This is a minimalist email newsletter tool written in Node.js. 

Why? Because I needed something really tiny and self-hosted to keep interested people updated about MNT projects, and I didn't want to feed email addresses into commercial third party services.

# Requirements

Only node.js 8.8+. Install using ```npm install```. 

Configure by creating ```config.json```:
````
{
  "port": 1234,
  "confirmSecret": "someRandomSaltyString",
  "baseUrl": "http://letters.exampler.org",
  "emailSignature": "\r\nUnsubscribe: {{=it.baseUrl}}/lists/{{=it.list}}/unsubscribe?email={{=it.email}}",
  "adminEmail": "admin@example.org",
  "adminPassword": "..."
}
````

# Data

All data including lists, subscribers and mailings is stored in a single JSON blob, ```db.json```. You can edit this to create new lists:

````
{
  "lists": {
    "test": {
      "name": "test",
      "title": "Test list"
    }
  }
}
````

# Post a Mailing

Find the editor for your list's mailing at an URL like:
```http://letters.example.org/lists/<list_name>/mailings/new```

Substitute *<list_name>* for the actual name of your list.

# Deployment

Set up a user, install nvm (and node.js 8.8) for this user. Then, create an init or unit file (if you use systemd), for example (```/etc/systemd/system/mntletter.service```):
````
[Unit]
Description=mntletter email newsletters

[Service]
ExecStart=/home/mntletter/start.sh
WorkingDirectory=/home/mntletter
Restart=always
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=mntletter
User=mntletter
Group=mntletter

[Install]
WantedBy=multi-user.target
````

You could use Nginx to reverse proxy it on a subdomain:
````
server {
    server_name letters.example.org;
    location / {
        proxy_pass http://127.0.0.1:1234;
    }
}
````

# License: MIT

Copyright 2017 Lukas F. Hartmann (@mntmn)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
