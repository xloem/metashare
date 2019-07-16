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
          // console.log('Calling out to ' + func + '(' + JSON.stringify(arguments) + ')')
          oldfunc.call(rpcOrig, ...arguments, (err, result) => {
            if (err) return reject(err)
            if (Array.isArray(result)) {
              var errs = result.filter(result => result.error !== null)
              // console.log('batch result: errs = ' + errs.length + ' total = ' + result.length)
              if (errs.length > 0) {
                reject(errs[0].error)
              } else {
                resolve(result.map(result => result.result))
              }
            } else {
              console.log('Function resolution from ' + func + '(' + JSON.stringify(arguments) + ') gave: ' + JSON.stringify([err, result]).substr(0, 1000))
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

  // rpc.getrawtransactions = async function(txids, verbose, blockhash) {

  // ummmmmmmmm
  // we want the txs in order
  // but can really generate them in any order we want
  // we can present some for generation
  // they may be returned in any order

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

  /*
  if (!('pendingTxs' in ctx.net.cust)) {
    ctx.net.cust.pendingTxs = {}
    await ctx.put('net', ctx.net.id, { 'cust': ctx.net.cust })
  }
  */

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
      // const rawtxs = await Promise.all(block.tx.map((txid) => rpc.getrawtransaction(txid, false, block.hash)))

      let i = 0
      if (ctx.net.cust.lastSyncedTX) {
        console.log('skipping to ' + ctx.net.cust.lastSyncedTX)
        while (block.tx[i].txid !== ctx.net.cust.lastSyncedTX) {
          ++i
        }
        ++i
      }
      // let j = i
      // const jStart = j
      // const tStart = Date.now()
      let foundTx = false
      for (; i < block.tx.length; ++i) {
        // console.log(block.tx[i].txid)
        ++txCount
        foundTx |= await syncFromRawTx(ms, block.tx[i].hex, block.hash)
        // if ((i + 1) % 256 === 0) {
        //   j = (i + 1)
        //   ctx.net.cust.lastSyncedTX = block.tx[i - 1]
        //   await ctx.put('net', ctx.net.id, { 'cust': ctx.net.cust })
        // }
      }
      console.log((txCount * 1000 / (Date.now() - startBT)) + 'tx/s ' + ((block.height - startHeight) * 1000 * 60 / (Date.now() - startBT)) + 'bl/m ' + (new Date(block.mediantime * 1000)).toString())
      /*

      let j = i
      const jStart = j
      const tStart = Date.now()
      const chunks = []
      while (true) {
        if (i < block.tx.length) {
          const chunkPromise = rpc.batch(() => {
            const chunktail = i + 16
            for (; i < block.tx.length && i < chunktail; ++i) {
              rpcOrig.getrawtransaction(block.tx[i], false, block.hash)
            }
          })
          chunks.push(chunkPromise)
        }
        while (chunks.length > (i < block.tx.length ? 2 : 0)) {
          const chunk = await chunks.shift()
          // console.log(chunk)
          j += chunk.length
          console.log(j + ' / ' + block.tx.length + ' (' + ((j - jStart) * 1000 / (Date.now() - tStart)) + 'tx/s ' + ((block.height - 1 - startHeight + j / block.tx.length) * 1000 * 60 / (Date.now() - startBT)) + 'bl/m)')
          for (let rawtx of chunk) {
            await syncFromRawTx(ms, rawtx, false)
          }
          ctx.net.cust.lastSyncedTX = block.tx[i - 1]
          await ctx.put('net', ctx.net.id, { 'cust': ctx.net.cust })
        }
        if (i >= block.tx.length) break
      }
*/
      /* const rawtxs = await rpc.batch(() => {
        console.log('getting batch')
        for (let txid of block.tx) {
          rpcOrig.getrawtransaction(txid, false, block.hash)
        }
        console.log('queued batch')
      }) */

      ctx.net.cust.lastSyncedBlock = block.hash
      delete ctx.net.cust.lastSyncedTX
      if (foundTx || block.height % 16 === 0) {
        await ctx.put('net', ctx.net.id, { 'cust': ctx.net.cust })
      }
      block = block.nextblockhash && await rpc.getblock(block.nextblockhash, 2)
    }

    for (let txid of await rpc.getrawmempool()) {
      const rawtx = await rpc.getrawtransaction(txid, true)
      await syncFromRawTx(rawtx.time, rawtx.hex)
    }

    async function syncFromRawTx (time, rawtx, block = null) {
      try {
        const tx = bitcore.Transaction(rawtx)
        if (block && tx.hash in mempooltxs) {
          delete mempooltxs[tx.hash]
          return
        }
        switch (tx.id) {
          case '06c9f9c14e009e946611d1ca84e64b63823e2f7500f345c3ea3a9514ec99c403':
            // invalid bitcoin cash blockchain transaction
            // contains an unfollow message with content ['Crypto', 'BCH is Bitcoin'].  likely user did not understand protocol.  there were no users named 'Crypto' at time of post.
            // event appears isolated
            // looks like user was following a different, unrelated protocol, that had a prefix overlap
            return
        }

        let foundTx = false
        let payments = {}
        let actions = []
        // console.log(tx.id)
        const userid = tx.inputs[0].script && tx.inputs[0].script.toAddress().toString()
        for (var vout = 0; vout < tx.outputs.length; ++vout) {
          const output = tx.outputs[vout]
          const script = bitcore.Script(output.script)
          if (!script.isDataOut()) {
            let addr = script.toAddress().toString()
            if (addr !== userid) {
              if (!(addr in payments)) {
                payments[addr] = output.satoshis
              } else {
                payments[addr] += output.satoshis
              }
            }
          } else {
            const data = Buffer.concat(script.chunks.map(chunk => chunk.buf || Buffer.alloc(0)))
            if (data.length < 2 || data[0] !== 0x6d) continue
            foundTx = true
            actions.push(vout)
          }
        }
        for (let vout of actions) {
          // console.log(tx.id + '#' + vout)
          await syncFromOutput(userid, time, tx, vout, tx.outputs[vout], payments)
        }
        if (block === null) { mempooltxs[tx.hash] = true }
        return foundTx
      } catch (err) {
        /* if (err instanceof ctx.metashare.MissingItemError) {
          if (!(err.id in ctx.net.cust.pendingTxs)) {
            ctx.net.cust.pendingTxs[err.id] = []
          }
          if (block !== null) {
            ctx.net.cust.pendingTxs[err.id].push({
              'type': err.type,
              'txid': tx.id,
              'block': block
            })
          } else {
            ctx.net.cust.pendingTxs[err.id].push({
              'type': err.type,
              'txid': tx.id,
              'time': time,
              'raw': rawtx
            })
          } // problem: miscreant could overload this list with bogus transactions ...
          await ctx.put('net', ctx.net.id, { 'cust': ctx.net.cust })
        } else { */
        throw err
        /* } */
      }
    }

    function bufToReverseString (buf, type, start, end = null) {
      if (end === null) end = buf.length
      if ((end - start) % 8 !== 0) throw new Error('unimplemented non-8 reverse')
      let ret = ''
      buf = buf.slice(start, end)
      buf.swap64()
      for (let chunk = buf.length - 8; chunk >= 0; chunk -= 8) {
        ret += buf.toString(type, chunk, chunk + 8)
      }
      return ret
    }

    // TODO: test that content stays consistent on arbitrary interrupt-and-reboot
    // TODO: test out-of-order opins/replies
    // TODO: add error table to log errors for easy review without halting server

    function isAscii (buf) {
      return buf.filter(c => c >= 0x80).length === 0
    }

    function bufToAddress (userid, addr) {
      if (isAscii(addr)) {
        // ascii data
        if (addr.length === 0) {
          // empty address, assume user meant themselves ?? TODO: don't handle this, handle malformed data
          addr = userid
        } else if (addr.length === 34) {
          // legacy address: convert to binary hash
          addr = bitcore.encoding.Base58Check.decode(addr.toString('ascii'))
        } else {
          // likely new-style ascii address that bitcore will parse
          addr = addr.toString('ascii')
        }
      } else {
        // non-ascii data: likely raw hash that bitcore will parse
        if (addr.length === 25) {
          // includes base58 checksum: check and remove
          addr = bitcore.encoding.Base58Check.decode(bitcore.encoding.Base58.encode(addr))
        }
      }
      // 0 present for network prefix
      if (Buffer.isBuffer(addr) && addr.length === 21 && addr[0] === 0) {
        addr = addr.slice(1)
      }
      return bitcore.Address(addr).toString()
    }

    function bufToTransaction (buf, offset) {
      if (isAscii(buf.slice(offset, offset + 32)) && buf.length >= offset + 64 && isAscii(buf.slice(offset, offset + 64))) {
        while (buf[offset] === 0x20) ++offset // remove leading space sometimes present
        return {
          postid: buf.slice(offset, offset + 64).toString('ascii'),
          nextOffset: offset + 64
        }
      } else if (buf.length >= offset + 32) {
        return {
          postid: bufToReverseString(buf, 'hex', offset, offset + 32),
          nextOffset: offset + 32
        }
      } else {
        throw new Error('unrecognised transaction id format')
      }
    }

    function postWithBreaks (buf, breaks, offset) {
      let ret = ''
      let lastbreak = buf.length
      for (let i = breaks.length - 1; i >= 0 && breaks[i] > offset; --i) {
        ret = '\n' + buf.slice(breaks[i], lastbreak).toString('utf8') + ret
      }
      ret = buf.slice(offset, lastbreak).toString('utf8') + ret
      return ret
    }

    async function syncFromOutput (userid, time, tx, vout, output, payments) {
      // first byte is already checked to match 0x6d in loop above
      const msgid = tx.hash
      if (!await ctx.get('user', userid)) {
        await ctx.put('user', userid, {
          time: time
        })
      }
      const script = bitcore.Script(output.script)
      /* if (!script.isDataOut()) {
        const uid = script.toAddress().toString()
        if (!await ctx.get('user', uid)) {
          return
          //await ctx.put('user', uid, {
          //  time: time
          //})
        }
        // TODO: rather than adding vout to msgid here,
        //   provide in the database a way to give multiple behaviors the same id-for-reference
        //      probably just means making the db robust in the face of non-unique ids;
        //      more than just checking for making multiple identical placeholders
        await ctx.put('opin', msgid + ':' + vout, {
          time: time,
          user: userid,
          // type: 'user',
          what: uid,
          value: output.satoshis / satoshisPerCurrency,
          how: 'tip',
          unit: currencyUnit
        })
        return
      } */
      const databuf = Buffer.concat(script.chunks.map(chunk => chunk.buf || Buffer.alloc(0)))
      const databreaks = []
      let lastbreak = 0
      for (let chunk of script.chunks) {
        if (chunk.buf) {
          lastbreak += chunk.buf.length
          databreaks.push(lastbreak)
        }
      }
      databreaks.pop()
      const msgtype = databuf[1]
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
          msg: postWithBreaks(databuf, databreaks, 2)
        })
      } else if (msgtype === 0x03) {
        // content is 32-byte replymsgid, message
        const pobj = bufToTransaction(databuf, 2)
        if (!await ctx.getPlaceholder('post', pobj.postid)) {
          await ctx.putPlaceholder('post', pobj.postid)
        }
        await ctx.put('post', msgid, {
          time: time,
          user: userid,
          reply: pobj.postid,
          msg: postWithBreaks(databuf, databreaks, pobj.nextOffset)
        })
      } else if (msgtype === 0x04) {
        // content is msgid(32)
        // means: like + tip
        const pobj = bufToTransaction(databuf, 2)
        if (pobj.nextOffset !== databuf.length) throw new Error('excess length to like')
        let unit // = undefined
        let value = 1
        const postget = await ctx.get('post', pobj.postid)
        if (!postget) {
          if (!await ctx.getPlaceholder('post', pobj.postid)) {
            await ctx.putPlaceholder('post', pobj.postid)
          }
          let sum = 0
          for (let payment in payments) {
            sum += payments[payment]
            delete payments[payment]
          }
          if (sum > 0) {
            value = sum / satoshisPerCurrency
            unit = currencyUnit
          }
        } else {
          if (postget.user in payments) {
            value = payments[postget.user] / satoshisPerCurrency
            unit = currencyUnit
            delete payments[postget.user]
          }
        }
        await ctx.put('opin', msgid, {
          time: time,
          user: userid,
          // type: 'post',
          what: pobj.postid,
          value: value,
          how: 'like',
          unit: unit
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
        // content is useraddr(35) to follow // actually, it can vary
        const uid = bufToAddress(userid, databuf.slice(2))
        if (!await ctx.get('user', uid)) {
          await ctx.put('user', uid, {
            time: time
          })
        }
        await ctx.put('opin', msgid, {
          time: time,
          user: userid,
          // type: 'user',
          what: uid,
          value: 1,
          how: 'follow'
        })
      } else if (msgtype === 0x07) {
        // content is useraddr(35) to unfollow // actually, it can vary
        const uid = bufToAddress(userid, databuf.slice(2))
        if (!await ctx.get('user', uid)) {
          await ctx.put('user', uid, {
            time: time
          })
        }
        await ctx.put('opin', msgid, {
          time: time,
          user: userid,
          // type: 'user',
          what: uid,
          value: -1,
          how: 'follow'
        })
      } else if (msgtype === 0x0a) {
        // profile picture url
        await ctx.put('prof', msgid, {
          time: time,
          user: userid,
          attr: 'picurl',
          val: databuf.toString('utf8', 2)
        })
      } else if (msgtype === 0x0b) {
        // unimplemented 'share' a message
        // msgid(32), commentary
        const pobj = bufToTransaction(databuf, 2)
        if (!await ctx.getPlaceholder('post', pobj.postid)) {
          await ctx.putPlaceholder('post', pobj.postid)
        }
        await ctx.put('post', msgid, {
          time: time,
          user: userid,
          share: pobj.postid,
          msg: postWithBreaks(databuf, databreaks, pobj.nextOffset)
        })
      } else if (msgtype === 0x0c) {
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
        await ctx.put('post', msgid, {
          time: time,
          user: userid,
          topic: topic,
          msg: postWithBreaks(databuf, databreaks, topicbreak)
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
          // type: 'topic',
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
          // type: 'topic',
          what: topic,
          value: -1,
          how: 'follow'
        })
      }
    }
  }

  return ret
}

// ran into a block transaction ordering issue
// seems preservation of tx ordering from the block didn't solve it
// block is 525927 00000000000000000057d4ade56fe7fe3b458797824547b3994049e615ad0cb1
// this txid is a like: cbf600a222c618779ad2d20203c18124de733f57608ccbd0cd79bca1d267dd0d (line 186)
// the like is of this: 7b076166376c9d44c1e29450c57ad7930e6292b0740366dd9e1ae3ca24e35365 (line 193)
// it's notable that because the op_return data is not processed by the miner,
// these transactions could be stored in the block in any possible order.
// it is even possible that a dependent transaction could be stored in a future block,
// due to mining choice.
// =====
// so we'll need to have a queue of pending transactions to make it work
//    thinking i can store an object in net.cust that is indexed by the missing txid
//    then when get a new txid, can look it up in net.cust to see if there are dependent txs to add too
// =====
// 1. detect when a what is missing e.g. by throwing an easy-to-process error
// 2. when missing, add txid & block to object index in net.cust
// 3. when new tx processed, check if it is in net.cust index, and process any that depend on it
// =====
// likes involve sending money, but to the person, not from their post transaction
