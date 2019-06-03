const Knex = require('knex');
const knex = Knex({
	client: 'sqlite3',
	connection: {
		filename: 'db/metashare.sqlite'
	}
})

module.exports = async function()
{
	await sequelize.authenticate()

	// still need to
	// 	- [/] update methods to use it
	// 	- [ ] update bridge code to assume it
	
	if (! await knex.schema.hasTable('item')) {
		await knex.schema.createTable('item', function(table) {
			table.comment('Network-local items, one for each.  Details are stored in separate tables under detail dbid.')
			table.increments('dbid')
			table.integer('detail').unsigned().notNullable().references('dbid')
				.comment('Index in item details table.')
			table.integer('net').unsigned().notNullable().references('orig').inTable('net')
			table.string('id').notNullable()
				.comment('Should be the most obvious string, to reduce clashing between independent bridge implementations.  Choose capitalization and whole name of original first choice made by network creator.')
			table.enu('type', ['net', 'user', 'prof', 'post', 'topic', 'opin']).notNullable()
				.comment('Table to find item details in.')
			table.unique(['net','type','id'])
			table.unique(['net', 'detail'])
			table.jsonbb('cust')
				.comment('network-local data')
		})
	}
	if (! await knex.schema.hasTable('net')) {
		await knex.schema.createTable('net', function(table) {
			table.comment('Net detail table')
			table.integer('orig').unsigned().primary().references('dbid').inTable('item')
				.comment('references item with type=net')
			table.timestamp('time', options={useTz: false}).notNullable()
			table.string('where')
			table.jsonb('config')
		})
	}
	if (! await knex.schema.hasTable('priv')) {
		await knex.schema.createTable('priv', function(table) {
			table.comment('Holds private user information to be shared only with them.')
			table.integer('dbid').unsigned().primary().references('dbid').inTable('item')
				.comment('references item with type=user')
			table.jsonb('priv')
				.comment('private key material etc')
		})
	}
	if (! await knex.schema.hasTable('user')) {
		await knex.schema.createTable('user', function(table) {
			table.comment('User detail table -- see prof for real details')
			table.integer('orig').unsigned().primary().references('dbid').inTable('item')
				.comment('references item with type=user')
			table.timestamp('time', options={useTz: false}).notNullable()
		})
	})
	if (! await knex.schema.hasTable('prof')) {
		await knex.schema.createTable('prof', function(table) {
			table.comment('Profile detail table')
			table.integer('orig').unsigned().primary().references('dbid').inTable('item')
				.comment('references item with type=prof')
			table.timestamp('time', options={useTz: false}).notNullable()
			table.integer('user').unsigned().notNullable().references('orig').inTable('prof')
				.comment('users are referred to by their first update')
			table.enu('attr', ['name', 'about', 'picurl'])
			table.string('val')
		})
	}
	if (! await knex.schema.hasTable('post')) {
		await knex.schema.createTable('post', function(table) {
			table.comment('Post detail table')
			table.integer('orig').unsigned().primary().references('dbid').inTable('item')
				.comment('references item with type=post')
			table.timestamp('time', options={useTz: false}).notNullable()
			table.integer('user').unsigned().notNullable().references('orig').inTable('prof')
			table.integer('reply').unsigned().references('orig')
			table.integer('topic').unsigned().references('orig').inTable('topic')
			table.string('msg')
		})
	}
	if (! await knex.schema.hasTable('topic')) {
		await knex.schema.createTable('topic', function(table) {
			table.comment('Topic detail table')
			table.integer('orig').unsigned().primary().references('dbid').inTable('item')
				.comment('references item with type=topic')
			table.timestamp('time', options={useTz: false})
			table.string('name')
		})
	}
	if (! await knex.schema.hasTable('opin')) {
		await knex.schema.createTable('opin', function(table) {
			table.integer('orig').unsigned().primary().references('dbid').inTable('item')
				.comment('references item with type=opin')
			table.timestamp('time', options={useTz: false}).notNullable()
			table.integer('user').unsigned().notNullable().references('orig').inTable('prof')
			table.integer('what').unsigned().notNullable().references('dbid').inTable('item')
			table.enu('how', ['like', 'follow'])
			table.float('value')
		})
	}

	this.get = async function(type, net, id, origdbid=null)
	{
		var item = knex('item')
			.first()
			.join(type, 'item.detail', type + '.dbid')
			.join({orig:'item'}, 'item.detail', 'item.dbid')
		if (type == 'user') {
			item
				.join('priv', 'item.dbid', 'priv.dbid')
		} else if (type == 'prof') {
			item
				.join({netuser:'item'}, {'netuser.net':net,'netuser.detail':'prof.user'})
		} else if (type == 'post') {
			item
				.join({netuser:'item'}, {'netuser.net':'item.net','netuser.detail':'post.user'})
				.leftJoin({netreply:'item'}, {'netreply.net':'item.net','netreply.detail':'post.reply'})
				.leftJoin({nettopic:'item'}, {'nettopic.net':'item.net','nettopic.detail':'post.topic'})
		} else if (type == 'opin') {
			item
				.join({netuser:'item'}, {'netuser.net':'item.net','netuser.detail':'opin.user'})
				.join({netwhat:'item'}, {'netwhat.net':'item.net','netwhat.detail':'opin.what'})
		}
		item
			.where('item.type', type)
			.andWhere('item.net', net)
		if (origdbid)
			item
				.andWhere('orig.dbid', origdbid)
		if (id)
			item
				.andWhere('item.id', id)
		item = await item


		const ret = {
			dbid: item.dbid,
			time: item[type].time,
			id: item.id,
			cust: item.cust,
			orig: item[type]
		}
		ret.orig.dbid = item.orig.dbid
		ret.orig.id = item.orig.id

		if (type == 'user') {
			ret.priv = item.priv.priv
		} else if (type == 'prof') {
			ret.user = item.netuser.id
			ret.attr = ret.orig.attr
			ret.val = ret.orig.val
		} else if (type == 'post') {
			ret.user = item.netuser.id
			ret.reply = item.netreply.id
			ret.topic = item.nettopic.id
		} else if (type == 'topic') {
			ret.name = object.name
		} else if (type == 'opin') {
			ret.user = item.netuser.id
			ret.what = item.netwhat.id
			ret.type = item.netwhat.type
		}
	}

	this.put = async function(type, net, object)
	{
		// this creates a new object from the provided network
		await knex.transaction(async function(trx)
		{
			object.dbid = (await trx('item')
				.returning('item.dbid')
				.insert({
					net: net,
					detail: 0,
					id: object.id,
					type: type,
					cust: object.cust
				}))[0]
			await trx('item').insert({detail: object.dbid}).where('dbid', object.dbid)
			if (type == 'net') {
				await trx('net').insert({
					orig: object.dbid,
					time: object.time,
					where: object.where,
					config: object.config
				})
			} else if (type == 'user') {
				await trx('user').insert({
					orig: object.dbid,
					time: object.time
				})
			} else if (type == 'prof') {
				await trx('prof').insert({
					orig: object.dbid,
					time: object.time,
					user: await trx('item')
						.first('dbid')
						.where('net', net)
						.andWhere('type', 'user')
						.andWhere('id', object.user),
					attr: object.attr,
					val: object.val
				})
			} else if (type == 'post') {
				await trx('post').insert({
					orig: object.dbid,
					time: object.time,
					user: await trx('item')
						.first('dbid')
						.where('net', net)
						.andWhere('type', 'user')
						.andWhere('id', object.user),
					reply: object.reply && await trx('item')
						.first('dbid')
						.where('net', net)
						.andWhere('type', 'post')
						.andWhere('id', object.reply),
					topic: object.topic && await trx('item')
						.first('dbid')
						.where('net', net)
						.andWhere('type', 'topic')
						.andWhere('id', object.topic)
				})
			} else if (type == 'topic') {
				await trx('topic').insert({
					orig: object.dbid,
					time: object.time,
					name: object.name
				})
			} else if (type == 'opin') {
				await trx('opin').insert({
					orig: object.dbid,
					time: object.time,
					user: await trx('item')
						.first('dbid')
						.where('net', net)
						.andWhere('type', 'user')
						.andWhere('id', object.user),
					what: await trx('item')
						.first('dbid')
						.where('net', net)
						.andWhere('type', object.type)
						.andWhere('id', object.what)
				})
			}
		})

		return object.dbid
	}

	this.mirror = async function(type, net, orig, object)
	{
		object.dbid = (await trx('item')
			.returning('item.dbid')
			.insert({
				net: net,
				detail: orig,
				id: object.id,
				type: type,
				cust: object.cust
			}))[0]
		return object.dbid
	}
}
