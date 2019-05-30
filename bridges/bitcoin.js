var bitcoindRpc = require('bitcoind-rpc')

// https://memo.cash/protocol
// https://github.com/memberapp/protocol/blob/master/README.md <-- larger
//
// user/pass substr is in ~/.bitcoin/.cookie
//
// addresses are P2PKH.  data is OP_RETURN.  codec is UTF-8
//
// set name		0x6d01	name(217)
// 	-> provide 'name' for 'user' by same user
// 	event: name
// 	message: name
// 	subject type: user
// 	subject: producer
// 	related type: name
// 	related: name(217)
// post memo		0x6d02	message(217)
// 	-> provide 'message' by 'user'
// 	subject type: message
// 	subject: message(217)
// reply to memo	0x6d03	txhash(32), message(184)
// 	-> provide 'message' by 'user' in 'reply' to 'message2'
// 	subject type: message
// 	subject: message(184)
// 	related type: reply
// 	related: txhash(32)
// like/tip memo	0x6d04  txhash(32)
// 	-> provide 'opinion' by 'user' for 'message'
// 	and/or
// 	-> provide 'payment' by 'user' for 'message'
// set profile text	0x6d05	message(217)
// 	-> provide 'profile message' for 'user'
// follow user		0x6d06	address(35)
// 	-> provide 'follow opinion' for 'user' by 'user2'
// unfollow user	0x6d07	address(35)
// 	-> reset 'follow opinion' for 'user' by 'user2'
// set profile picture	0x6d0a	url(217)
// 	-> provide 'profile picture message' for 'user'
// repost memo		0x6d0b	txhash(32), message(184) // not yet implemented on website
// post topic message	0x6d0c	topic_name(n), message(214 - n)
// 	-> provide 'message' by 'user' under 'topic'
// topic follow		0x6d0d	topic_name(n)
// 	-> provide 'follow opinion' for 'topic' by 'user'
// topic unfollow	0x6d0e	topic_name(n)
// 	-> reset 'follow opinion' for 'topic' by 'user'
// create poll		0x6d10	poll_type(1), option_count(1), question(209)
// add poll option	0x6d13	poll_txhash(32), option(184)
// poll vote		0x6d14	poll_txhash(32), comment(184)
// send money		0x6d24	message(217)
// 	-> provide 'message' for 'user' by 'user2'
// 	and/or
// 	-> provide 'payment' for 'user' by 'user2'
// missing: private messages, private topics
// custom: 0x5d01 imported network
// 	   0x5d02 imported network id

// so we have a list of things provided
// can add more, and enumerate past
// each one has a TIME and a UNIQUE ID and a USER who did it
// major concepts:
// 	- user
// 	- message
// 	- 'for' relation
// smaller concepts:
// 	- name
//	- opinion? ('like' message, 'follow' user)
//	- payment
//	- 'reply' relation
//	- 'topic' relation (group?)
//	- 'profile picture' 'profile text'
//
// so, we'll function in terms of events of the above concepts
// we'll want to be able to
// 	- stream them
// 	- provide them
// 	- access past values
// 		for accessing past values, let's allow for iterating within a timerange
// 		and for providing filters such as only 'by' or only 'reply'
// 		filters could be in the form of relations with missing pieces
// 	so, to share filter and event, we'll want a data structure that holds every
// 	event.
// 	
// 	- time
// 	- producer
// 	- unique id
// 	- subject type
// 	- subject
//	- optional related type
//	-          related
//
//	- time
//	- user
//	- event type
//		- event subtype
//	- optional message
//	- optional other user
//	- optional other message
//
//	blaaargh
//	let's just provide for indexing by time
//	and make normal functions ??????

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
// 	- set profile info
// 	- send new message
// 	- send message in topic
// 	- reply to message
// 	- history of messages
// 	- 'like' a message or person
// 	- 'tip' a message or person
// 	what else?
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

// WE NEED TO MOVE TOWARDS WORLD PATTERNS THAT RESPECT EVERYBODY'S JUDGEMENT
// THIS IS 100% POSSIBLE
modules.exports = function(metashareContext)
{
	// we all need to be able to continue our lives in ways we know to work
	var bitcore = require(metashareContext.config.bitcore || 'bitcore-lib-cash')
	var startblockheight = metashareContext.config.startheight || 584830

	var ret = {}

	var rpcUrl
	var networkConfig = metashareContext.where || (require('os').homedir()+'/.bitcoin')
	try {
		var userpass = fs.readFileSync(networkConfig + '/.cookie').toString().split(':')
		rpcUrl = 'http://' + userpass + '@127.0.0.1:8332/'
	} catch(e) {
		rpcUrl = networkConfig
	}
	

	var rpc = new bitcoindRpc(rpcUrl)

	for (func in rpc) {
		if (typeof rpc[func] == 'function') {
			let oldfunc = rpc[func]
			rpc[func] = function()
			{
				return new Promise(resolve, reject, function()
				{
					args = Array.prototype.slice.apply(arguments)
					args.push(function(err, result)
					{
						if (err) reject(err)
						if (result.error) reject(result.error)
						resolve(result.result)
					})
					oldfunc.apply(rpc, args)
				})
			}
		}
	}

	// if we want to check network,
	// one way is to check the first block hash
	// but this will not handle new forks
	// can be done with rpc.getblockhash(0, cb)
	
	var feePerKB = await rpc.estimatefee()

	// TODO: scan history to accumulate names and such
	// probably connect to metashare api to access local db
	//
	// 1. get from metashare time of last update from us
	//	-> metashareContext.lastSync
	//
	// 2. provide function to publish new events
	// 3. play history forward from last time
	//    and tell metashare each new event
	//    	-> let's tag bridged messages such that different bridges can verify and reuse
	
	async function setUtxo(userObj, txid)
	{
		var txout = await rpc.gettxout(txid, 0)
		userObj.utxo = {
			'txId': txid,
			'outputIndex': 0,
			'address': userObj.id,
			'script': txout.scriptPubKey.hex,
			'satoshis': Math.round(txout.value * 10**8)
		}
		if (txout.value < feePerKB) {
			// replenish when value is low

			var tx = new bitcore.Transaction()
				.from(userObj.utxo)
			var unspents = await rpc.listunspent()
			var total = txout.value
			var changeAddr = userObj.id
			var privKeys = {userObj.id:userObj.priv.key}
			for (unspent in unspents) {
				if (total >= feePerKB) break
				if (!unspent.solvable) continue
				txout = await rpc.gettxout(unspent.txid, unspent.vout)
				tx = tx.from({
					'txId': unspent.txid,
					'outputIndex': unspent.vout,
					'address': unspent.address,
					'script': txout.scriptPubKey.hex,
					'satoshis': Math.round(txout.value * 10**8)
				})
				if (!(unspent.address in privKeys)) {
					privKeys[unspent.address] = await rpc.dumpprivkey(unspent.address)
					changeAddr = unspent.address
				}
				total += txout.value
			}
			tx = tx.to(userObj.id, feePerKB)
			       .change(changeAddr)
			for (addr in privKeys)
			{
				tx = tx.sign(privKeys[addr])
			}
			delete privKeys

			await setUtxo(userObj, await rpc.sendrawtransaction(tx.serialize()))
		}
	}

	function data2address(data)
	{
		var address = new bitcore.Address(bitcore.crypto.Hash.sha256ripemd160(new Buffer(data)))
		return address.toString()
	}

	async function sendData(userObj, data)
	{
		var tx = new bitcore.Transaction()
			.from(userObj.utxo)
			.change(userObj.id)
			.addData(data)
			.sign(userObj.priv.key)
		txid = await rpc.sendrawtransaction(tx.serialize())
		await setUtxo(userObj, txid)
		return txid
	}

	async function sendMarkers(userObj, addresses)
	{
		if (typeof addresses == 'string')
			addresses = [ addresses ]
		var tx = new bitcore.Transaction()
			.from(userObj.utxo)
			.change(userObj.id)
		for (address of addresses)
			tx = tx.to(address, 0)
		tx = tx.sign(userObj.priv.key)
		txid = await rpc.sendrawtransaction(tx.serialize())
		await setUtxo(userObj, txid)
		return txid
	}

	async function syncSister(network)
	{
		// assuming multiple parallel mirrors of the same network
		// updates from remote work so as to not repeat it, since each item is
		//    stored permanently and shared with all
		
		var count = 1000
		while(true) {
			var txsjson = rpc.listtransactions(network.global.id, count, skip, true)
			var usertxs = {}
			for (var txjson of txsjson) {
				if (txjson.address != network.id) continue
				//var txid = txjson.txid
				//var tx = await rpc.gettransaction(txid, true)
				// -> tx.details _only_ includes _our_ addresses
				// 		at least, with chain unindexed
				// TODO: when blockchain reindex, iterate addresses and map them
				// TODO: blockhash may be nonpresent for unconfirmed information
				var tx = await rpc.getrawtransaction(txjson.txid, true, txjson.blockhash)
				var remoteuserid = tx.vout[0].addresses[0]
				var userid = tx.vout[2].addresses[0]

				if (!(userid in network.user_links))
					network.user_links[userid] = []
				network.user_links[userid].push({
					'remote': remoteuserid,
					'block': txjson.blockhash
				})
				// once we have all userids associated with all their accounts
				// and the block hash or height in which they start
				// how do we find preposted messages to not repost them?
				// i think we'll want to scan every block!
			}
			network.count_read += txsjson.length
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
		// 	-> .blockhash gives block
		// 	-> .blockindex gives location in block
		// 	-> .time gives creation time
		// 	-> .details[].category -> send/receive
		// 	-> .details[].address -> address
		// 	-> .details[].vout -> vout index
		// 	-> .hex -> raw transaction
		//
		// listtransactions account count skip true
		// 		true is to include_watchonly

		// propose we keep transaction count in database
		// using metashare.getLocal('network', global.network) to get an object
		// returns array:
		// 	-> .address  should be used to filter
		// 	-> .category  send/receive
		// 	-> .amount   negative for send
		// 	-> .vout   vout index
		// 	-> .blockhash    block id containing
		// 	-> .blockindex   location in block
		// 	-> .txid         txid
		// 	-> .time         creation time
		//

		
	}

	async function importNetwork(network)
	{
		network.id = data2address(network.global.id)
		network.count_read = 0
		network.user_links = {}

		await rpc.importaddress(network.id, network.global.id, false)
		await rpc.rescanblockchain(startblockheight)
		if (await rpc.getaccount(network.id) != network.global.id)
			throw new Error("Failed to import network account for " + network.global.id + ": " + network.id + "?")

		syncSister(network)
	}
	
	// need a local datastore ...
	// guess metashare has it.

	ret.create = async function(type, obj)
	{
		if (type == 'network') {
			var network = obj
			await importNetwork(network)
		} else if (type == 'user') {
			var user = obj
			var key = bitcore.PrivateKey()
			user.priv.key = key.toWIF()
			user.id = key.toAddress()

			var network = metashareContext.get('network', user.global.network)

			// 1. send money to set name
			// 	-> need to use rpc to fill account
			setUtxo(user, await rpc.sendtoaddress(user.id, feePerKB * 2))

			// notify any peer processes of this user mirror
			var userlink = data2address(user.global.id)
			sendMarkers(local, [network.id, userlink])

			if (user.global.name) {
				user.name = (user.global.name + '@' + user.global.network).substr(0, 217)
				sendData(user, '\x6d\x01' + user.name)
			}
			if (user.global.about) {
				user.about = user.global.about.substr(0, 217)
				sendData(user, '\x6d\x05' + user.about)
			}
			if (user.global.picture && user.global.picture.length <= 217) {
				sendData(user, '\x6d\x0a' + user.global.picture)
			}

			for (link of network.user_links[userlink]) {
				sendData(user, '\x6d\x06' + link.remote)
			}
		} else if (type == 'post') {
			var post = obj
			var user = metashareContext.get('user', post.global.user)
			var msg = obj.global.msg
			var datapfx, datalen
			if (post.global.reply) {
				var replyid = metashareContext.get('post', post.global.reply).id
				datapfx = '\x6d\x03' + Buffer(replyid, "hex").toString()
				datalen = 184
			} else if (post.global.topic && post.global.topic.length < 214) {
				datapfx = '\x6d\x0c' + post.global.topic
				datalen = 214 - post.global.topic.length
			} else {
				datapfx = '\x6d\x02'
				datalen = 217
			}
			var firstmsg = msg.substr(0, datalen)
			if (msg.length > datalen) {
				var newdatalen = msg.lastIndexOf(' ', datalen-5)
				if (newdatalen < datalen - 32)
					newdatalen = datalen - 4
				datalen = newdatalen
				firstmsg = msg.substr(0, datalen) + ' ...'
			}
			post.id = sendData(user, datapfx + firstmsg)
			for (var i = datalen; i < msg.length; i += 184) {
				sendData(user, '\x6d\x03' + post.id + msg.substr(i, 184))
			}
		} else if (type == 'opin') {
			var opin = obj
			var type = opin.global.type
			var user = metashareContext.get('user', opin.global.user)
			if (type == 'post' && opin.global.value > 0) {
				var post = metashareContext.get('post', opin.global.what).id
				opin.id = sendData(Buffer("6d04" + post, "hex"))
			} else if (type == 'user' && opin.global.how == 'follow') {
				var user = metashareContext.get('user', opin.global.what).id
				opin.id = sendData(Buffer(
					(opin.global.value > 0 ? '6d06' : '6d07')
						+ bitcore.Address(user).toObject().hash,
					'hex'))
			} else if (type == 'topic' && opin.global.how == 'follow' && opin.global.what.length < 214) {
				opin.id = sendData(
					(opin.global.value > 0 ? '\x6d\x0d' : '\x6d\x0e')
						+ opin.global.what)
			}
		}
	}

	ret.publish = function(evt)
	{
		// translate and broadcast evt object
		// will need translation scheme.
		// will want to label network and name

		// with memo we will likely want to make an account for every user
		// and ensure it has enough finances to post
		//
		// if we run out of money, we'll need to post a request for donations
		// which will be done as one lump fund here.  for clarity.

		var sourceUser

		if (evt.source) {
			sourceUser = metashare.getLocalId('user', evt.source)
			if (! sourceUser) {
				sourceUser = ;// TODO: create blockchain account
				metashare.setLocalId('user', evt.source, sourceUser)
			}
		}
		var source = metashare.getLocalId('user', evt.source)

		if (evt.message)
		{
			// send message
			// can use evt.reply, evt.topic
		}
	}
	
	ret.history = function(start, end)
	{
		// output historical events
	}

	return ret

	// for now,
	// network == rpc url
	// credentials == private key
	
	// connect to bitcoin cash and translate memo network
	// credentials must include private key
	// network must include rpc endpoint
}
