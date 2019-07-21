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
// post topic message 0x6d0c  topic_name(n), message(214 - n)
//  -> provide 'message' by 'user' under 'topic'
// topic follow   0x6d0d  topic_name(n)
//  -> provide 'follow opinion' for 'topic' by 'user'
// topic unfollow 0x6d0e  topic_name(n)
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

  var bitcore = require(ctx.net.cust.config.bitcore || 'bitcore-lib-cash')
  var startblock = ctx.net.cust.config.startblock
  var currencyUnit = ctx.net.cust.config.currencyUnit || 'BCH'
  var satoshisPerCurrency = ctx.net.cust.config.satoshisPerCurrency || 100000000

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
    var rpcOrig = new BitcoindRpc(rpcUrl)
  } catch (e) {
    e.message = "Got '" + e.message + "' trying to connect to '" + networkConfig + "' -- is it running?"
    throw e
  }

  /*
  const rpcwork = {
    ongoing: new Set(),
    cur: 0,
    min: 16,
    max: Infinity,
    queueDrain: null
  } */

  const rpc = {}

  for (let func in rpcOrig) {
    if (typeof rpcOrig[func] === 'function') {
      const oldfunc = rpcOrig[func]
      rpc[func] = async function () {
        return new Promise((resolve, reject) => {
          oldfunc.call(rpcOrig, ...arguments, (err, result) => {
            if (err) return reject(err)
            if (Array.isArray(result)) {
              var errs = result.filter(result => result.error !== null)
              if (errs.length > 0) {
                reject(errs[0].error)
              } else {
                resolve(result.map(result => result.result))
              }
            } else {
              if (func !== 'getblock') {
                console.log('Function resolution from ' + func + '(' + JSON.stringify(arguments) + ') gave: ' + JSON.stringify([err, result]).substr(0, 1000))
              }
              if (result.error !== null) {
                reject(result.err)
              } else {
                resolve(result.result)
              }
            }
          })
        })
      }
    }
  }

  /*
  rpc.genrawtransactions = async function * (txids, verbose, blockhash) {
    const ongoing = new Set()
    const min = 1
    const max = Infinity
    const generated = []
    const nextYield = 0
    const lastQueued = 0
    for (let txid of txids) {
      if (ongoing.size > min) {
        // genned gives no information on which promise was resolved in the race
        const genned = await Promise.race(ongoing)
        ongoing.delete(genned)

      }
      const queueing = rpc.getrawtransaction(txid, verbose, blockhash)
      queueing.idx = lastQueued
      ongoing.add(queueing)
      ++ lastQueued
    }
  }
  */

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
      if (verificationpct >= 0.999) { // 1) {
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

  var startblockheight = startblock ? (await rpc.getblock(startblock)).height : 0
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
    // TODO FIXME: this needs to be updated to respect what we learned about the profile when importing:
    //        - variable lengths are not prefixed by length
    //        - each parameter is a different pushed chunk in the output
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
    var block = startblock
    if (ctx.net.cust.lastSyncedBlock) {
      let block2 = await rpc.getblock(ctx.net.cust.lastSyncedBlock)
      if (block2.height >= startblockheight) {
        block = block2.nextblockhash
      }
    } else if (!block) {
      block = await rpc.getblockhash(0)
    }
    block = block && await rpc.getblock(block, 2)
    var startHeight, startBT, txCount
    if (block) {
      startHeight = block.height - 1
      startBT = Date.now()
      txCount = 0
    }

    while (block) {
      while (block.tx.length <= 1 && block.nextblockhash) { block = await rpc.getblock(block.nextblockhash, 2) }
      const ms = block.time * 1000
      /*
      let rawtxs = await rpc.getrawtransactions(block.tx, false, block.hash)
      let proms = new Set()
      for (let i = 0; i < block.tx.length; ++ i) {
        const txid = block.tx[i]
        try {
          let prom = rpc.getrawtransaction(txid, false, block.hash)
          proms.add(prom)
          rawtxs[i] = await prom
          proms.delete(prom)
        } catch (e) {
          proms.delete(prom)
          if (e.code === 429) {
          }
        }
      }
      */

      let foundTx = false
      for (let i = 0; i < block.tx.length; ++i) {
        ++txCount
        foundTx |= await syncFromRawTx(ms, block.tx[i].hex, block.hash)
      }
      console.log((txCount * 1000 / (Date.now() - startBT)) + 'tx/s ' + ((block.height - startHeight) * 1000 * 60 / (Date.now() - startBT)) + 'bl/m ' + (new Date(block.mediantime * 1000)).toString())

      ctx.net.cust.lastSyncedBlock = block.hash
      delete ctx.net.cust.lastSyncedTX
      if (foundTx || block.height % 16 === 0) {
        await ctx.put('net', ctx.net.id, { 'cust': ctx.net.cust })
      }
      block = block.nextblockhash && await rpc.getblock(block.nextblockhash, 2)
    }

    let mempool = await rpc.getrawmempool(true)
    for (let txid in mempool) {
      const rawtx = await rpc.getrawtransaction(txid)
      await syncFromRawTx(mempool[txid].time, rawtx)
    }

    async function syncFromRawTx (time, rawtx, block = null) {
      const tx = bitcore.Transaction(rawtx)
      try {
        if (block && tx.hash in mempooltxs) {
          delete mempooltxs[tx.hash]
          return
        }
        // ignored transactions
        // this is temporary while scraping the blockchain to identify protocol norms
        // once these are known, handle all unexpected content reliably (and log errors, preferably as messages from the net)
        switch (tx.id) {
          case '4d015e59aa35c74bcdd9aa27ac140df3c373ec547e89ce9fee15b52112b5bf13': // 526123
            // follow-user contains no user to follow

            // fallthrough
          case '06c9f9c14e009e946611d1ca84e64b63823e2f7500f345c3ea3a9514ec99c403': // 530829
            // invalid bitcoin cash blockchain transaction
            // contains an unfollow message with content ['Crypto', 'BCH is Bitcoin'].  likely user did not understand protocol.  there were no users named 'Crypto' at time of post.
            // event appears isolated
            // looks like user was following a different, unrelated protocol, that had a prefix overlap

            // fallthrough
          case '8ad5337789cec14df5612ccfe587fd800d3f377ecd42249d51ea002588a22e2d': // 530840
          case 'ede4343d85c3b2ea64883d23af3f19857c9c9245eadb6d1b4c8c2a4d9ba4fc00': // 534081
          case 'ae150a9cace3dd49fbb8ebf62127d981c887ca0b3792ccfd7f67d5ed1da92342': // 541980
          case '607d443b8a162e9bc17640fee777af05fe97b2e33cf875033b5932d61c1faa01': // 544676
          case '234d3842ce8ba4d7ed315ee008b68ef8734f1fec7085e52ecf10e83163adacbf': // 556196
          case '24ed4fbee493eb5ee692f45a5cea9730733a966b63ff7e87d968b8deffc3becf': // 556572
            // OP_RETURN transaction appears just base64 data that happens to start with 0x6d

            // fallthrough
            // case '1d57d68290c55da5c42dd195b1aef4de86e9cba42ea3e1e15d481324f5f0d0ba': // 532151
            //   // unrecognised data-only message type 0x33 which is within protocol range

            // fallthrough
          case '54b06848695ccab784425d584195cb6d41a28147e5feb5f3f2cc8f70ca688689': // 533787
            // this looks like an experiment by somebody trying to figure out the protocol
            // it uses an address format that is a truncated chunk of the Base58Check format
            // prefix 0 is removed, as are the last 2 bytes of the checksum, leading to a 22-byte
            //  binary address

            //  fallthrough
          case '7e0fd53df0236031511bd8cbc37967c6b416566da7b64ccf545df5d255c262c6': // 535607
            // this advert for memberapp.github.io (the github of which has a nice protocol doc)
            // is posted as a message but has id for unfollow

            // fallthrough
          case '455a010d45f2126965abe5e1d5f7f2030753f37721ca1bf242e0040a8b55b8c4': // 548147
          case '53aa3365c521e64aeee4522f8347772e26886e9a190cda0ad12ea071abef5216': // 555287
            // tips have an empty post reference

            // fallthrough
          case '8ca96457d42e47538a40c821b6c483577bc2629c76f7f9601d393e00522c7d62': // 548674
            // like refers to a post by a txid that is 2 bytes short
            // the start and end bytes match a real txid, but the middle does not
            return
        }

        let foundTx = false
        let payments = []
        let actions = []

        if (!tx.inputs[0].script) return // coinbase (block reward) transactions have no author in this protocol
        const userid = tx.inputs[0].script.toAddress().toString()
        for (var vout = 0; vout < tx.outputs.length; ++vout) {
          const output = tx.outputs[vout]
          const script = bitcore.Script(output.script)
          if (!script.isDataOut()) {
            let addr = script.toAddress().toString()
            if (addr !== userid) {
              payments.push(vout)
            }
          } else {
            const data = Buffer.concat(script.chunks.map(chunk => chunk.buf || Buffer.alloc(0)))
            if (data.length < 2 || (data[0] !== 0x6d && data[0] !== 0xe9)) continue
            actions.push(vout)
          }
        }
        for (let vout of actions) {
          foundTx = (await syncFromOutput(userid, time, tx, vout, tx.outputs[vout], payments)) ? true : foundTx
        }
        if (foundTx) {
          for (let vout of payments) {
            await syncFromOutput(userid, time, tx, vout, tx.outputs[vout], payments)
          }
        }
        if (block === null) { mempooltxs[tx.hash] = true }
        return foundTx
      } catch (e) {
        e.message = (block || rawtx) + ':' + tx.hash + ': ' + e.message
        throw e
      }
    }

    function bufToReverseString (buf, type, start, end = null) {
      if (end === null) end = buf.length
      if ((end - start) % 8 !== 0) throw new Error('unimplemented non-8 reverse')
      let ret = ''
      buf = Buffer.from(buf.slice(start, end))
      buf.swap64()
      for (let chunk = buf.length - 8; chunk >= 0; chunk -= 8) {
        ret += buf.toString(type, chunk, chunk + 8)
      }
      return ret
    }

    // TODO: test that content stays consistent on arbitrary interrupt-and-reboot
    // TODO: log errors as posts from the net

    function isAscii (buf) {
      return buf.filter(c => c >= 0x80).length === 0
    }

    function bufToAddress (userid, addr) {
      if (isAscii(addr)) {
        // ascii data
        /* if (addr.length === 0) {
          // empty address, assume user meant themselves ?? TODO: don't handle this, handle malformed data
          addr = userid
        } else */ if (addr.length === 34) {
          // legacy address: convert to binary hash
          addr = bitcore.encoding.Base58Check.decode(addr.toString('ascii'))
        } else {
          // likely new-style ascii address that bitcore will parse
          addr = addr.toString('ascii')
        }
      } else {
        // non-ascii data: likely raw hash that bitcore will parse
        if (addr.length === 24) {
          // likely checksum included but prefix zero not
          addr = Buffer.concat([Buffer.from([0]), addr])
        }
        if (addr.length === 25) {
          // includes base58 checksum: check and remove
          addr = bitcore.encoding.Base58Check.decode(bitcore.encoding.Base58.encode(addr))
        }
      }
      // prefix of 0 present
      if (Buffer.isBuffer(addr) && addr.length === 21 && addr[0] === 0) {
        addr = addr.slice(1)
      }
      return bitcore.Address(addr).toString()
    }

    function bufToTransaction (buf, offset) {
      let ret
      if (isAscii(buf.slice(offset, offset + 32)) && buf.length >= offset + 64 && isAscii(buf.slice(offset, offset + 64))) {
        while (buf[offset] === 0x20) ++offset // remove leading space sometimes present
        const txid = buf.slice(offset, offset + 64).toString('ascii')
        ret = {
          postid: txid,
          revpostid: bufToReverseString(Buffer.from(txid, 'hex'), 'hex', 0),
          nextOffset: offset + 64
        }
      } else if (buf.length >= offset + 32) {
        ret = {
          postid: bufToReverseString(buf, 'hex', offset, offset + 32),
          revpostid: buf.toString('hex', offset, offset + 32),
          nextOffset: offset + 32
        }
      } else {
        throw new Error('unrecognised transaction id format')
      }
      return ret
    }

    function postWithBreaks (buf, breaks, offset) {
      let ret = ''
      let lastbreak = buf.length
      for (let i = breaks.length - 1; i >= 0 && breaks[i] > offset; --i) {
        if (breaks[i] === lastbreak) continue
        ret = '\n' + buf.slice(breaks[i], lastbreak).toString('utf8') + ret
      }
      ret = buf.slice(offset, lastbreak).toString('utf8') + ret
      return ret
    }

    async function syncFromOutput (userid, time, tx, vout, output, payments) {
      // first byte is already checked to match 0x6d in loop above
      const msgid = tx.hash
      const revmsgid = bufToReverseString(Buffer.from(tx.hash, 'hex'), 'hex', 0)
      if (!await ctx.get('user', userid)) {
        await ctx.put('user', userid, {
          time: time
        })
      }
      const script = bitcore.Script(output.script)
      if (!script.isDataOut()) {
        const addr = script.toAddress().toString()
        if (!await ctx.get('user', addr)) {
          await ctx.put('user', addr, {
            time: time
          })
        }
        await ctx.put('opin', msgid + ':' + vout, {
          time: time,
          user: userid,
          what: addr,
          value: output.satoshis / satoshisPerCurrency,
          how: 'pay',
          unit: currencyUnit,
          link: msgid
        })
        return true
      }
      const databuf = Buffer.concat(script.chunks.map(chunk => chunk.buf || Buffer.alloc(0)))
      const databreaks = []
      let lastbreak = 0
      for (let chunk of script.chunks) {
        if (chunk.buf) {
          lastbreak += chunk.buf.length
          databreaks.push(lastbreak)
        }
      }
      const msgtype = databuf.readUInt16BE(0)
      switch (msgtype) {
        case 0x6d01: {
          // content is user name
          await ctx.put('prof', msgid, {
            user: userid,
            time: time,
            attr: 'name',
            val: databuf.toString('utf8', 2)
          })
          break
        }
        case 0x6d02: {
          // content is message
          await ctx.put('post', [msgid, revmsgid], {
            time: time,
            user: userid,
            msg: postWithBreaks(databuf, databreaks, 2)
          })
          break
        }
        case 0x6d03: {
          // content is 32-byte replymsgid, message
          const pobj = bufToTransaction(databuf, 2)
          // TODO FIXME
          // we have some incorrect placeholders placed because sometimes the input to bufToTransaction
          // is actually entered backwards.
          // the worst case scenario here is that the placeholder is made first, with a backwards ref,
          // and then the real item is encountered, with its forward ref.
          // so:
          // 1. update the references to placeholders if there is one for a reverse id when an item is made
          //      this could be handled by the central lib by considering alternate ids that could be used
          // if the placeholder is made second, then we can find the correct reference by just looking
          // for the reverse id
          // 1. [X] TAKE LIST OF ALTERNATE IDS WHEN PUTTING SOMETHING
          //    check alternate ids to remove placeholders
          //    -> removes 1 placeholder with id-that-can-be-alternate, untested
          //    -> object.id may be an array
          // 2. [X] PROVIDE REVERSED ID FOR EVERY POST PUT, as alternate
          // 3. [X] TAKE LIST OF ALTERNATE IDS IN getPlaceholder
          //    [X]   might be nice to make ctx.getOrPutPlaceholder(type, ids)
          // 4. [X] PROVIDE ALTERNATE REVERSED ID FOR getPlaceholder('post' AND UPDATE LOCAL PLACEHOLDER FOR IT
          const postid = await ctx.getOrPutPlaceholder('post', [pobj.postid, pobj.revpostid])
          await ctx.put('post', [msgid, revmsgid], {
            time: time,
            user: userid,
            reply: postid,
            msg: postWithBreaks(databuf, databreaks, pobj.nextOffset)
          })
          break
        }
        case 0x6d04: {
          // content is msgid(32)
          // means: like + tip
          let pobj = bufToTransaction(databuf, 2)
          if (pobj.nextOffset !== databuf.length) throw new Error('excess length to like')
          const postid = await ctx.getOrPutPlaceholder('post', [pobj.postid, pobj.revpostid])
          await ctx.put('opin', msgid, {
            time: time,
            user: userid,
            what: postid,
            value: 1,
            how: 'like'
          })
          break
        }
        case 0x6d05: {
          // content is profile text
          await ctx.put('prof', msgid, {
            time: time,
            user: userid,
            attr: 'about',
            val: databuf.toString('utf8', 2)
          })
          break
        }
        case 0x6d06: {
          // content is useraddr to follow
          let uid = bufToAddress(userid, databuf.slice(2))
          uid = await ctx.getOrPutPlaceholder('user', uid)
          await ctx.put('opin', msgid, {
            time: time,
            user: userid,
            what: uid,
            value: 1,
            how: 'follow'
          })
          break
        }
        case 0x6d07: {
          // content is useraddr to unfollow
          let uid = bufToAddress(userid, databuf.slice(2))
          uid = await ctx.getOrPutPlaceholder('user', uid)
          await ctx.put('opin', msgid, {
            time: time,
            user: userid,
            what: uid,
            value: -1,
            how: 'follow'
          })
          break
        }
        case 0x6d0a: {
          // profile picture url
          await ctx.put('prof', msgid, {
            time: time,
            user: userid,
            attr: 'picurl',
            val: databuf.toString('utf8', 2)
          })
          break
        }
        case 0x6d0b: {
          // unimplemented 'share' a message
          // msgid(32), commentary
          const pobj = bufToTransaction(databuf, 2)
          const postid = await ctx.getOrPutPlaceholder('post', [pobj.postid, pobj.revpostid])
          await ctx.put('post', [msgid, revmsgid], {
            time: time,
            user: userid,
            share: postid,
            msg: postWithBreaks(databuf, databreaks, pobj.nextOffset)
          })
          break
        }
        case 0x6d0c: {
          // post topic message
          // topic(n), message(214 - n)
          let topicbreak = 2
          for (let dbreak of databreaks) {
            if (dbreak > topicbreak) {
              topicbreak = dbreak
              break
            }
          }
          const topic = databuf.toString('utf8', 2, topicbreak)
          if (!await ctx.get('topic', topic)) {
            await ctx.put('topic', topic, {
              time: time
            })
          }
          await ctx.put('post', [msgid, revmsgid], {
            time: time,
            user: userid,
            topic: topic,
            msg: postWithBreaks(databuf, databreaks, topicbreak)
          })
          break
        }
        case 0x6d0d: {
          // content is topic name(n) to follow
          const topic = databuf.toString('utf8', 2)
          if (!await ctx.get('topic', topic)) {
            await ctx.put('topic', topic, {
              time: time
            })
          }
          await ctx.put('opin', msgid, {
            time: time,
            user: userid,
            what: topic,
            value: 1,
            how: 'follow'
          })
          break
        }
        case 0x6d0e: {
          // content is topic name(n) to unfollow
          const topic = databuf.toString('utf8', 2)
          if (!await ctx.get('topic', topic)) {
            await ctx.put('topic', topic, {
              time: time
            })
          }
          await ctx.put('opin', msgid, {
            time: time,
            user: userid,
            what: topic,
            value: -1,
            how: 'follow'
          })
          break
        }
        case 0x6d10: {
          // content is poll_type(1), option_count(1), poll_question(209)
          // can also be option_count(1), poll_question(n)
          // poll_type and option_count are single bytes without length
          // so they are received as chunks with only opcodenum (num + 0x50), and no buf
          let opcodes = script.chunks
            .filter(c => !('buf' in c))
            .map(c => c.opcodenum - 0x50)
            .slice(1)
          let type // = undefined
          if (opcodes.length > 2) {
            throw new Error('too many poll single opcodes')
          } else if (opcodes.length === 2) {
            switch (opcodes[0]) {
              case 1:
                type = 'poll.single'
                break
              case 2:
                type = 'poll.multi'
                break
              case 3:
                type = 'poll.rank'
                break
              default:
                throw new Error('unknown poll type ' + opcodes[0])
            }
          }
          await ctx.put('post', [msgid, revmsgid], {
            time: time,
            user: userid,
            msg: postWithBreaks(databuf, databreaks, 2),
            xmod: type
          })
          break
        }
        case 0x6d13: {
          // content is poll_txhash(32), option(184)
          const pobj = bufToTransaction(databuf, 2)
          const postid = await ctx.getOrPutPlaceholder('post', [pobj.postid, pobj.revpostid])
          await ctx.put('post', [msgid, revmsgid], {
            time: time,
            user: userid,
            reply: postid,
            msg: postWithBreaks(databuf, databreaks, pobj.nextOffset),
            xmod: 'poll.option'
          })
          break
        }
        case 0x6d14: {
          // content is option_txhash(32), comment(184)
          const pobj = bufToTransaction(databuf, 2)
          const postid = await ctx.getOrPutPlaceholder('post', [pobj.postid, pobj.revpostid])
          // the problem is that replies/likes are assumed to bind to posts, not opins
          // and both them and payments are done to conventional id
          // and we are using two different ids to aid in mapping
          // and sometimes there is a payment without a post
          // and sometimes there is a reply/like on the post
          // ended up using a half-baked solution of giving the canonical id sometimes to the post,
          // and sometimes to the opin
          const msg = postWithBreaks(databuf, databreaks, pobj.nextOffset)
          if (msg.length) {
            await ctx.put('post', [msgid, revmsgid], {
              time: time,
              user: userid,
              reply: postid,
              msg: msg
            })
          }
          await ctx.put('opin', msg.length ? msgid + ':' + vout : msgid, {
            time: time,
            user: userid,
            what: postid,
            value: 1,
            how: 'vote',
            link: msg.length ? msgid : undefined
          })
          break
        }
        case 0x6d24: {
          // content is ostensibly message, but we see addr preceding it
          // is _to_ the user money is sent to, for the money send
          if (payments.length !== 1) throw new Error('send money with no single other recipient')
          const payout = tx.outputs[payments[0]]
          const dest = bitcore.Script(payout.script).toAddress().toString()
          if (databreaks[databreaks.length - 1] > 2) {
            if (bufToAddress(databuf.slice(2, databreaks[databreaks.length - 1])) !== dest) {
              throw new Error('mismatching address for sendmoney')
            }
          } else {
            if (databreaks[databreaks.length - 1] !== 2) {
              throw new Error('unexpected sendmoney databreak')
            }
          }
          await ctx.put('post', [msgid, revmsgid], {
            time: time,
            user: userid,
            to: dest,
            msg: postWithBreaks(databuf, databreaks, 2)
          })
          break
        }
        case 0x6da8: {
          // this is a memberapp geolocated message
          // 3 chunks: 6da8 geohash msg
          // geohash can turn to lat/lon with require('ngeohash').decode(str)
          if (databreaks[0] !== 2) throw new Error('geotag chunk assumption wrong')
          const geohash = databuf.slice(databreaks[0], databreaks[1])
          await ctx.put('post', [msgid, revmsgid], {
            time: time,
            user: userid,
            msg: 'geotagged geo:hash=' + geohash + '\n' + postWithBreaks(databuf, databreaks, databreaks[1])
          })
          break
        }
        case 0xe901:
          // saw some magnet links with likes linking to them with this prefix
          // e901 url ext name
          if (databreaks[0] !== 2 || databreaks.length < 3) {
            throw new Error('filemsg chunk assumption wrong')
          }
          await ctx.put('post', [msgid, revmsgid], {
            time: time,
            user: userid,
            msg: '[' + postWithBreaks(databuf, databreaks, databreaks[2]) + '.' + databuf.slice(databreaks[1], databreaks[2]) + '](' + databuf.slice(databreaks[0], databreaks[1]) + ')'
          })
          break
        case 0x6d08:
          // these contain some short messages but don't appear to be part of the memo protocol
          return false
        case 0x6d15:
          // started getting hex-encoded binary data under this prefix starting block 553367
          // don't know what it is
          return false
        default:
          if (msgtype >= 0x30) return false
          throw Error('unrecognised message type 0x' + Buffer.from([msgtype]).toString('hex'))
      }
      return true
    }
  }

  return ret
}
