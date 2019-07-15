const BitcoindRpc = require('bitcoind-rpc')
const netstat = require('node-netstat')
const fs = require('fs')
const os = require('os')

// https://memo.cash/protocol
// https://github.com/memberapp/protocol/blob/master/README.md <-- larger
//
// user/pass substr is in ~/.bitcoin/.cookie
//
// addresses are P2PKH.  data is OP_RETURN.  codec is UTF-8
//
// set name   0x6d01  name(217)
//  -> provide 'name' for 'user' by same user
//  event: name
//  message: name
//  subject type: user
//  subject: producer
//  related type: name
//  related: name(217)
// post memo    0x6d02  message(217)
//  -> provide 'message' by 'user'
//  subject type: message
//  subject: message(217)
// reply to memo  0x6d03  txhash(32), message(184)
//  -> provide 'message' by 'user' in 'reply' to 'message2'
//  subject type: message
//  subject: message(184)
//  related type: reply
//  related: txhash(32)
// like/tip memo  0x6d04  txhash(32)
//  -> provide 'opinion' by 'user' for 'message'
//  and/or
//  -> provide 'payment' by 'user' for 'message'
// set profile text 0x6d05  message(217)
//  -> provide 'profile message' for 'user'
// follow user    0x6d06  address(35)
//  -> provide 'follow opinion' for 'user' by 'user2'
// unfollow user  0x6d07  address(35)
//  -> reset 'follow opinion' for 'user' by 'user2'
// set profile picture  0x6d0a  url(217)
//  -> provide 'profile picture message' for 'user'
// repost memo    0x6d0b  txhash(32), message(184) // not yet implemented on website
// post topic message 0x6d0c  n(1) topic_name(n), message(214 - n)
//  -> provide 'message' by 'user' under 'topic'
// topic follow   0x6d0d  n(1) topic_name(n)
//  -> provide 'follow opinion' for 'topic' by 'user'
// topic unfollow 0x6d0e  n(1) topic_name(n)
//  -> reset 'follow opinion' for 'topic' by 'user'
// create poll    0x6d10  poll_type(1), option_count(1), question(209)
// add poll option  0x6d13  poll_txhash(32), option(184)
// poll vote    0x6d14  poll_txhash(32), comment(184)
// send money   0x6d24  message(217)
//  -> provide 'message' for 'user' by 'user2'
//  and/or
//  -> provide 'payment' for 'user' by 'user2'
// missing: private messages, private topics

// so we have a list of things provided
// can add more, and enumerate past
// each one has a TIME and a UNIQUE ID and a USER who did it
// major concepts:
//  - user
//  - message
//  - 'for' relation
// smaller concepts:
//  - name
//  - opinion? ('like' message, 'follow' user)
//  - payment
//  - 'reply' relation
//  - 'topic' relation (group?)
//  - 'profile picture' 'profile text'
//
// so, we'll function in terms of events of the above concepts
// we'll want to be able to
//  - stream them
//  - provide them
//  - access past values
//    for accessing past values, let's allow for iterating within a timerange
//    and for providing filters such as only 'by' or only 'reply'
//    filters could be in the form of relations with missing pieces
//  so, to share filter and event, we'll want a data structure that holds every
//  event.
//
//  - time
//  - producer
//  - unique id
//  - subject type
//  - subject
//  - optional related type
//  -          related
//
//  - time
//  - user
//  - event type
//    - event subtype
//  - optional message
//  - optional other user
//  - optional other message
//
//  blaaargh
//  let's just provide for indexing by time
//  and make normal functions ??????

// in memo every event is data and vice versa
// universal reference is transaction hash
// this is true of most blockchains
// _but_ users are referred to by addresses, even though they could be referred to
//  by first event
//
// so, we have items: people, topics, messages, events?
// and we have relation between them.
// people post messages, optionally with topics
//

// memo functions:
//  - set profile info
//  - send new message
//  - send message in topic
//  - reply to message
//  - history of messages
//  - 'like' a message or person
//  - 'tip' a message or person
//  what else?
//
// memo appears to have an app that takes commands.  karl tries to install it

// metashareContext provides database for context objects we provide
// it itself is a database for our network context
// and inherits information from general metashare network
//
// so, we can treat it like a class, and query for sub-bits
// but it will need to sync with longterm storage
//
// getStore(type, id)
//
// will want to link our objects to shared objects ...
// so we'll want to associate our ids with global ids
//

// this bridge is for memo.cash, a blockchain attempting to be uncensorable by incentivizing sharing
//   and securing.
// hopefully should also be easy to make work for memo.sv (and memo.core if there is one)
// NOTE: sv has no max datasize anymore.  can we jut remove it and everything will work fine?
//   might require a PR to their website code.

// TODO: we'll want to provide for reviewing history to verify consistency and fix bugs after
// the fact.  we'll want to provide a function to query our history for this review.

// this software is likely to result in peaceful communities where existing powers are still in charge
// we are available to make modifications to preserve that goal: the one on the table here is providing for paid censorship

// WE WANT TO MOVE TOWARDS WORLD PATTERNS THAT RESPECT EVERYBODY'S JUDGEMENT
// THIS IS 100% POSSIBLE
module.exports = async function (ctx) {
  // we all need to be able to continue our lives in ways we know to work

  var bitcore = require(ctx.net.cust.bitcore || 'bitcore-lib-cash')
  var startblockheight = ctx.net.cust.startheight || 584830

  var ret = {}

  var rpcUrl = null
  var networkConfig = ctx.net.where || (os.homedir() + '/.bitcoin')
  try {
    const userpass = fs.readFileSync(networkConfig + '/.cookie').toString()
    const bitcoindpid = parseInt(fs.readFileSync(networkConfig + '/bitcoind.pid'))
    netstat({ filter: { pid: bitcoindpid, state: 'LISTEN' }, sync: true }, (svc) => {
      if (svc.local.address) {
        rpcUrl = 'http://' + userpass + '@' + svc.local.address + ':' + svc.local.port + '/'
        return false
      }
      if (rpcUrl === null) { rpcUrl = 'http://' + userpass + '@127.0.0.1:' + svc.local.port + '/' }
    })
  } catch (e) {
    rpcUrl = networkConfig
  }

  try {
    var rpc = new BitcoindRpc(rpcUrl)
  } catch (e) {
    e.message = "Got '" + e.message + "' trying to connect to '" + networkConfig + "' -- is it running?"
    throw e
  }

  for (let func in rpc) {
    if (typeof rpc[func] === 'function') {
      const oldfunc = rpc[func]
      rpc[func] = function () {
        return new Promise((resolve, reject) => {
          const args = Array.prototype.slice.apply(arguments)
          args.push(function (err, result) {
            if (err !== null) return reject(err)
            console.log('Function resolution from ' + func + '(' + JSON.stringify(args) + ') gave: ' + JSON.stringify([err, result]))
            if (result.error) return reject(result.error)
            return resolve(result.result)
          })
          oldfunc.apply(rpc, args)
        })
      }
    }
  }

  {
    let startms = Date.now()
    let startpct = null
    while (true) {
      let verificationpct = 0
      let block
      try {
        block = await rpc.getblockchaininfo()
        if (block.initialblockdownload === false) break
        if (block.mediantime + 60 * 60 > Date.now() / 1000) break
        verificationpct = block.verificationprogress
      } catch (e) {
        if (!('code' in e) || e.code !== -28) throw e
        console.log('NODE IS BOOTING UP: ' + e.message)
      }
      if (verificationpct >= 1) {
        break
      } else if (verificationpct > 0) {
        let now = Date.now()
        if (startpct === null || verificationpct < startpct) {
          startpct = verificationpct
          startms = now
        }
        let etams = (1.0 - verificationpct) * (now - startms) / (verificationpct - startpct)
        console.log('WAITING TO FINISH CHAIN VERIFICATION: ' + (verificationpct * 100) + '%' + (startpct === verificationpct ? '' : ' ETA: ' + (new Date(now + etams)).toLocaleString()))
      }

      await new Promise((resolve) => { setTimeout(resolve, 1000) })
    }
  }

  var feePerKB = await rpc.estimatefee()

  function messagebuf (numbers, message) {
    return Buffer.concat([Buffer.from(numbers), Buffer.from(message)])
  }

  async function setUtxo (user, txid) {
    var txout = await rpc.gettxout(txid, 0)
    user.cust.utxo = {
      txId: txid,
      outputIndex: 0,
      address: user.id,
      script: txout.scriptPubKey.hex,
      satoshis: Math.round(txout.value * 10 ** 8)
    }
    if (txout.value < feePerKB) {
      // replenish when value is low

      var tx = new bitcore.Transaction()
        .from(user.cust.utxo)
      var unspents = await rpc.listunspent()
      var total = txout.value
      var changeAddr = user.id
      var privKeys = {}
      privKeys[user.id] = user.priv.key
      for (let unspent in unspents) {
        if (total >= feePerKB) break
        if (!unspent.solvable) continue
        txout = await rpc.gettxout(unspent.txid, unspent.vout)
        tx = tx.from({
          txId: unspent.txid,
          outputIndex: unspent.vout,
          address: unspent.address,
          script: txout.scriptPubKey.hex,
          satoshis: Math.round(txout.value * 10 ** 8)
        })
        if (!(unspent.address in privKeys)) {
          privKeys[unspent.address] = await rpc.dumpprivkey(unspent.address)
          changeAddr = unspent.address
        }
        total += txout.value
      }
      tx = tx.to(user.id, feePerKB)
        .change(changeAddr)
      for (let addr in privKeys) {
        tx = tx.sign(privKeys[addr])
        delete privKeys[addr]
      }

      await setUtxo(user, await rpc.sendrawtransaction(tx.serialize()))
    }
  }

  function data2address (data) {
    var address = new bitcore.Address(bitcore.crypto.Hash.sha256ripemd160(Buffer.from(data)))
    return address.toString()
  }

  async function sendData (user, data) {
    var tx = new bitcore.Transaction()
      .from(user.cust.utxo)
      .change(user.id)
      .addData(data)
      .sign(user.priv.key)
    const txid = await rpc.sendrawtransaction(tx.serialize())
    await setUtxo(user, txid)
    return txid
  }

  async function sendMarkers (user, addresses) {
    if (typeof addresses === 'string') { addresses = [ addresses ] }
    var tx = new bitcore.Transaction()
      .from(user.cust.utxo)
      .change(user.id)
    for (let address of addresses) { tx = tx.to(address, 0) }
    tx = tx.sign(user.priv.key)
    const txid = await rpc.sendrawtransaction(tx.serialize())
    await setUtxo(user, txid)
    return txid
  }

  // TODO needs polishing to prevent multiple mirrors redoing each others' work.
  async function syncSister (net) {
    // assuming multiple parallel mirrors of the same network
    // updates from remote work so as to not repeat it, since each item is
    //    stored permanently and shared with all

    var count = 1000
    while (true) {
      var txsjson = rpc.listtransactions(net.origid, count, net.cust.count_read, true)
      // var usertxs = {}
      for (var txjson of txsjson) {
        if (txjson.address !== net.id) continue
        // var txid = txjson.txid
        // var tx = await rpc.gettransaction(txid, true)
        // -> tx.details _only_ includes _our_ addresses
        //    at least, with chain unindexed
        // TODO: when blockchain reindex, iterate addresses and map them
        // TODO: blockhash may be nonpresent for unconfirmed information
        var tx = await rpc.getrawtransaction(txjson.txid, true, txjson.blockhash)
        var remoteuserid = tx.vout[0].addresses[0]
        var userid = tx.vout[2].addresses[0]

        if (!(userid in net.cust.user_links)) { net.cust.user_links[userid] = [] }
        net.cust.user_links[userid].push({
          remote: remoteuserid,
          block: txjson.blockhash
        })
        // once we have all userids associated with all their accounts
        // and the block hash or height in which they start
        // how do we find preposted messages to not repost them?
        // i think we'll want to scan every block!
      }
      net.cust.count_read += txsjson.length
      if (txsjson.length < count) break
    }
    // there is now a MAP in network.user_links of userid to remote instances
    // when we get a new IMPORTED event, we want to walk forward along user_links[userid].remote to
    // make sure it is not already posted .. unless we do want to mirror such posts for clarity of following one user =/

    // account is now imported and associate transactions can be
    //   enumerated

    // we want each post to only be shared once
    // but we don't want to add every possible user to our wallet at this time
    // the wallet information on creation transactions probably gives us a block number that other transactions are likely to be in
    // so we can use block lookup to find htem

    // gettransaction
    //  -> .blockhash gives block
    //  -> .blockindex gives location in block
    //  -> .time gives creation time
    //  -> .details[].category -> send/receive
    //  -> .details[].address -> address
    //  -> .details[].vout -> vout index
    //  -> .hex -> raw transaction
    //
    // listtransactions account count skip true
    //    true is to include_watchonly

    // propose we keep transaction count in database
    // using metashare.getLocal('network', global.network) to get an object
    // returns array:
    //  -> .address  should be used to filter
    //  -> .category  send/receive
    //  -> .amount   negative for send
    //  -> .vout   vout index
    //  -> .blockhash    block id containing
    //  -> .blockindex   location in block
    //  -> .txid         txid
    //  -> .time         creation time
    //
  }

  async function importNet (net) {
    // to reference objects, we want their origin id to be available, and their origin net id
    net.id = data2address(await ctx.get('net', net.dbid, net.origid))
    net.cust = {
      count_read: 0,
      user_links: {}
    }

    await rpc.importaddress(net.id, net.origid, false)
    await rpc.rescanblockchain(startblockheight)
    if (await rpc.getaccount(net.id) !== net.origid) { throw new Error('Failed to import network account for ' + net.origid + ': ' + net.id + '?') }

    syncSister(net)

    return net
  }

  async function importUser (user) {
    // TODO: to update 'create' call to 'put' call, add considering that these
    //  things could already be created
    // this can be done by storing last state in the local object, so next
    // changes can be compared
    // ^-- above is needed only to handle simultaneous processes, I believe
    if (!user.id) {
      var key = bitcore.PrivateKey()
      user.priv = {
        key: key.toWIF()
      }
      user.id = key.toAddress()
      user.cust = {}

      var net = await ctx.get('net', user.netdbid)

      // send initial money
      await setUtxo(user, await rpc.sendtoaddress(user.id, feePerKB * 2))

      // notify any peer processes of this user mirror
      // concept is incomplete
      var userlink = data2address(user.origid)
      await sendMarkers(user, [net.id, userlink])

      // send a follow message to peer mirrors, to make them visible
      // concept is incomplete
      for (let link of net.cust.user_links[userlink]) {
        await sendData(user, messagebuf([0x6d, 0x06], link.remote))
      }
    }
    return user
  }

  async function importProf (prof) {
    var net = await ctx.get('net', prof.netdbid)
    var user = await ctx.get('user', prof.user)
    if (prof.attr === 'name') {
      prof.cust = (prof.val + ' @' + net.origid).substr(0, 217)
      prof.id = await sendData(user, messagebuf([0x6d, 0x01], prof.cust))
    } else if (prof.attr === 'about') {
      prof.cust = prof.val.substr(0, 217)
      prof.id = await sendData(user, messagebuf([0x6d, 0x05], prof.cust))
    } else if (prof.attr === 'picurl' && prof.val.length <= 217) {
      prof.id = await sendData(user, messagebuf([0x6d, 0x0a], prof.val))
    }
    return prof
  }

  async function importTopic (topic) {
    topic.id = topic.name.substr(0, 214)
    let idx = 1
    while ((await ctx.get('topic', topic.id)).length > 0) {
      ++idx
      topic.id = topic.name.substr(0, 209) + ' ' + idx
    }
    return topic
  }

  async function importPost (post) {
    const user = await ctx.get('user', post.user)
    const msg = post.msg
    var datapfx, datalen
    if (post.reply) {
      const replyid = (await ctx.get('post', post.reply)).id
      datapfx = Buffer.from('6d03' + replyid, 'hex')
      datalen = 184
    } else if (post.topic) {
      const topic = (await ctx.get('topic', post.topic)).id
      datapfx = messagebuf([0x6d, 0x0c, topic.length], topic)
      datalen = 214 - topic.length
    } else {
      datapfx = messagebuf([0x6d, 0x02], '')
      datalen = 217
    }
    var firstmsg = msg.substr(0, datalen)
    if (msg.length > datalen) {
      var newdatalen = msg.lastIndexOf(' ', datalen - 5)
      if (newdatalen < datalen - 32) { newdatalen = datalen - 4 }
      datalen = newdatalen
      firstmsg = msg.substr(0, datalen) + ' ...'
    }
    post.id = await sendData(user, Buffer.concat([datapfx, Buffer.from(firstmsg)]))
    post.cust = [post.id]
    for (var i = datalen; i < msg.length; i += 184) {
      const nextid = await sendData(user, Buffer.concat([Buffer.from('6d03' + post.id, 'hex'), Buffer.from(msg.substr(i, 184))]))
      post.cust.push(nextid)
    }
    return post
  }

  async function importOpin (opin) {
    const type = opin.type
    const src = await ctx.get('user', opin.user)
    if (type === 'post' && opin.value > 0) {
      const post = await ctx.get('post', opin.what).id
      opin.id = await sendData(src, Buffer.from('6d04' + post, 'hex'))
    } else if (type === 'user' && opin.how === 'follow') {
      const user = await ctx.get('user', opin.what).id
      opin.id = await sendData(src, Buffer.from(
        (opin.value > 0 ? '6d06' : '6d07') +
         bitcore.Address(user).toObject().hash,
        'hex'))
    } else if (type === 'topic' && opin.how === 'follow') {
      const topic = (await ctx.get('topic', opin.what)).id
      opin.id = await sendData(messagebuf([0x6d, opin.value > 0 ? 0x0d : 0x0e, topic.length], topic))
    }
    return opin
  }

  ret.put = async function (type, obj) {
    if (type === 'net') {
      return importNet(obj)
    } else if (type === 'user') {
      return importUser(obj)
    } else if (type === 'prof') {
      return importProf(obj)
    } else if (type === 'topic') {
      return importTopic(obj)
    } else if (type === 'post') {
      return importPost(obj)
    } else if (type === 'opin') {
      return importOpin(obj)
    }
  }

  var mempooltxs = {}

  ret.sync = async function () {
    var block
    if (ctx.net.cust.lastSyncedBlock) {
      block = await rpc.getblock(ctx.net.cust.lastSyncedBlock)
      block = block.nextblockhash
    } else {
      block = await rpc.getblockhash(0)
    }
    block = block && await rpc.getblock(block)

    while (block) {
      while (block.tx.length <= 1 && block.nextblockhash) { block = await rpc.getblock(block.nextblockhash) }
      const ms = block.time * 1000
      for (var txid of block.tx) {
        const rawtx = await rpc.getrawtransaction(txid, false, block.hash)
        await syncFromRawTx(ms, rawtx, false)
      }
      ctx.net.cust.lastSyncedBlock = block.hash
      await ctx.put('net', ctx.net.id, { 'cust': ctx.net.cust })
      block = block.nextblockhash && await rpc.getblock(block.nextblockhash)
    }

    for (txid of await rpc.getrawmempool()) {
      const rawtx = await rpc.getrawtransaction(txid, true)
      await syncFromRawTx(rawtx.time, rawtx.hex, true)
    }

    async function syncFromRawTx (time, rawtx, mempool) {
      const tx = bitcore.Transaction(rawtx)
      if (!mempool && tx.hash in mempooltxs) {
        delete mempooltxs[tx.hash]
        return
      }
      for (var output of tx.outputs) {
        const script = bitcore.Script(output.script)
        if (!script.isDataOut()) continue
        const data = script.getData()
        if (data.length < 2 || data[0] !== 0x6d) continue
        await syncFromOutput(time, tx, data)
      }
      if (mempool) { mempooltxs[tx.hash] = true }
    }

    async function syncFromOutput (time, tx, databuf) {
      // first byte is already checked to match 0x6d in loop above
      const msgtype = databuf[1]
      const msgid = tx.hash
      const userid = tx.inputs[0].script.toAddress().toString()
      if (!await ctx.get('user', userid)) {
        await ctx.put('user', userid, {
          time: time
        })
      }
      if (msgtype === 0x01) {
        // content is user name
        await ctx.put('prof', msgid, {
          user: userid,
          time: time,
          attr: 'name',
          val: databuf.toString('utf8', 2)
        })
      } else if (msgtype === 0x02) {
        // content is message
        await ctx.put('post', msgid, {
          time: time,
          user: userid,
          msg: databuf.toString('utf8', 2)
        })
      } else if (msgtype === 0x03) {
        // content is 32-byte replymsgid, message
        await ctx.put('post', msgid, {
          time: time,
          user: userid,
          reply: databuf.toString('hex', 2, 4),
          msg: databuf.toString('utf8', 2 + 4)
        })
      } else if (msgtype === 0x04) {
        // content is msgid(32)
        // means: like + tip
        await ctx.put('opin', msgid, {
          time: time,
          user: userid,
          type: 'post',
          what: databuf.toString('hex', 2),
          value: 1,
          how: 'like'
        })
      } else if (msgtype === 0x05) {
        // content is profile text
        await ctx.put('prof', msgid, {
          time: time,
          user: userid,
          attr: 'about',
          val: databuf.toString('utf8', 2)
        })
      } else if (msgtype === 0x06) {
        // content is useraddr(35) to follow
        await ctx.put('opin', msgid, {
          time: time,
          user: userid,
          type: 'user',
          what: databuf.toString('hex', 2),
          value: 1,
          how: 'follow'
        })
      } else if (msgtype === 0x07) {
        // content is useraddr(35) to unfollow
        await ctx.put('opin', msgid, {
          time: time,
          user: userid,
          type: 'user',
          what: databuf.toString('hex', 2),
          value: -1,
          how: 'follow'
        })
      } else if (msgtype === 0x0a) {
        // profile picture url
        await ctx.put('prof', msgid, {
          time: time,
          user: userid,
          type: 'picurl',
          val: databuf.toString('utf8', 2)
        })
      } else if (msgtype === 0x0b) {
        // unimplemented 'share' a message
        // msgid(32), commentary
        await ctx.put('post', msgid, {
          time: time,
          user: userid,
          share: databuf.toString('hex', 2, 4),
          msg: databuf.toString('utf8', 2 + 4)
        })
      } else if (msgtype === 0x0c) {
        // post topic message
        // namelen(1), topic(n), message(214 - n)
        const namelen = databuf[2]
        const topic = databuf.toString('utf8', 3, 3 + namelen)
        if (!await ctx.get('topic', topic)) {
          await ctx.put('topic', topic, {
            time: time
          })
        }
        await ctx.put('post', msgid, {
          time: time,
          user: userid,
          topic: topic,
          msg: databuf.toString('utf8', 3 + namelen)
        })
      } else if (msgtype === 0x0d) {
        // content is n(1) and topic name to follow
        const namelen = databuf[2]
        const topic = databuf.toString('utf8', 3, 3 + namelen)
        if (!await ctx.get('topic', topic)) {
          await ctx.put('topic', topic, {
            time: time
          })
        }
        await ctx.put('opin', msgid, {
          time: time,
          user: userid,
          type: 'topic',
          what: topic,
          value: 1,
          how: 'follow'
        })
      } else if (msgtype === 0x0e) {
        // content is n(1) and topic name to unfollow
        const namelen = databuf[2]
        const topic = databuf.toString('utf8', 3, 3 + namelen)
        if (!await ctx.get('topic', topic)) {
          await ctx.put('topic', topic, {
            time: time
          })
        }
        await ctx.put('opin', msgid, {
          time: time,
          user: userid,
          type: 'topic',
          what: topic,
          value: -1,
          how: 'follow'
        })
      }
    }
  }

  return ret
}
