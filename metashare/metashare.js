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
	// 	- [ ] update bridge code to assume new interface
	
	const typeNames = ['net', 'user', 'prof', 'post', 'topic', 'opin']
	
	if (! await knex.schema.hasTable('item')) {
		await knex.schema.createTable('item', function(table) {
			table.comment('Network-local items, one for each.  Details are stored in separate tables under detail dbid@item')
			table.increments('dbid@item')
			table.integer('detail@$type').unsigned().notNullable().references('dbid@item')
				.comment('Index in item details table.')
			table.integer('@net').unsigned().notNullable().references('dbid@item').inTable('net')
			table.string('id').notNullable()
				.comment('Should be the most obvious string, to reduce clashing between independent bridge implementations.  Choose capitalization and whole name of original first choice UUID made by creator.')
			table.enu('$type', typeNames).notNullable()
				.comment('Table to find item details in.')
			table.unique(['@net','$type','id'])
			table.unique(['@net', 'detail@$type'])
			table.jsonbb('cust')
				.comment('network-local data')
		})
	}
	if (! await knex.schema.hasTable('net')) {
		await knex.schema.createTable('net', function(table) {
			table.comment('Net detail table')
			table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
				.comment('references item with type=net')
			table.timestamp('time', options={useTz: false}).notNullable()
			table.string('where')
			table.jsonb('config')
		})
	}
	if (! await knex.schema.hasTable('priv')) {
		await knex.schema.createTable('priv', function(table) {
			table.comment('Holds private user information to be shared only with them.')
			table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
				.comment('references item with type=user')
			table.jsonb('priv')
				.comment('private key material etc')
		})
	}
	if (! await knex.schema.hasTable('user')) {
		await knex.schema.createTable('user', function(table) {
			table.comment('User detail table -- see prof for real details')
			table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
				.comment('references item with type=user')
			table.timestamp('time', options={useTz: false}).notNullable()
		})
	})
	if (! await knex.schema.hasTable('prof')) {
		await knex.schema.createTable('prof', function(table) {
			table.comment('Profile detail table')
			table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
				.comment('references item with type=prof')
			table.timestamp('time', options={useTz: false}).notNullable()
			table.integer('@user').unsigned().notNullable().references('dbid@item').inTable('user')
			table.enu('attr', ['name', 'about', 'picurl'])
			table.string('val')
		})
	}
	if (! await knex.schema.hasTable('post')) {
		await knex.schema.createTable('post', function(table) {
			table.comment('Post detail table')
			table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
				.comment('references item with type=post')
			table.timestamp('time', options={useTz: false}).notNullable()
			table.integer('@user').unsigned().notNullable().references('orig').inTable('user')
			table.integer('reply@post').unsigned().references('orig')
			table.integer('@topic').unsigned().references('orig').inTable('topic')
			table.string('msg')
		})
	}
	if (! await knex.schema.hasTable('topic')) {
		await knex.schema.createTable('topic', function(table) {
			table.comment('Topic detail table')
			table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
				.comment('references item with type=topic')
			table.timestamp('time', options={useTz: false})
			table.string('name')
		})
	}
	if (! await knex.schema.hasTable('opin')) {
		await knex.schema.createTable('opin', function(table) {
			table.integer('dbid@item').unsigned().primary().references('dbid@item').inTable('item')
				.comment('references item with type=opin')
			table.timestamp('time', options={useTz: false}).notNullable()
			table.integer('@user').unsigned().notNullable().references('orig').inTable('user')
			table.integer('what@item').unsigned().notNullable().references('dbid@item').inTable('item')
			table.enu('how', ['like', 'follow'])
			table.float('value')
		})
	}

	const schemas = {}
	for (typename of typeNames) {
		const colsRef = []
		const colsNonref = []
		const typeColumnInfo = await knex(typename).columnInfo()
		for (column in typeColumnInfo).columnInfo()) {
			const parts = column.split('@', 2)
			if (parts.length < 2) {
				colsNonref.push(column)
			} else {
				if (parts[0] == 'dbid') continue // primary key ref kept implicit
				colsRef.push({
					col: column,
					name: parts[0] || parts[1],
					ref: parts[1],
					nullable: typeColumnInfo[column].nullable
				])
			}
		})
		schemas[typename] = {
			colsref : colsRef,
			colsnonref : colsNonref
		}
	}

	// TODO: provide for censorship option?  to allow karl to continue work more easily
	// 		we believe karl can resist inhibition and would like more rapid aid
	// 		karl reports he is really worn out with regard to internal mediation
	// 		and he would like to just struggle to work, and is happy to pursue whichever
	// 		path kind of ends up influencing him
	// 	2 options: mark item as censored
	// 		OR: convert item to hash so is not even in database, but can be recognized,
	// 			and then mark as censored
	//
	// 	we're thinking as this reaches a point of actual workability, so will the choices
	// 	made in its design.  sw is far cry from functioning atm and will likely need some more
	// 	redesign to actually work, due to how _much_ data there will be to process.
	// 		to confirm, the approach of this sw design does not accomodate the amount of
	// 		data it is expected to encounter, even on startup.
	// 			karl is an experienced coder and enjoys working through problems as
	// 			they happen

	this.get = async function(type, netdbid, fields)
	{
		var items = knex('item')
			.select()
			.join(type, 'item.detail@$type', type + '.dbid@item')
			.join({orig:'item'}, 'item.detail@$type', 'item.dbid@item')
		const schema = schemas[type]
		for (colref of schema.colsref) {
			const _table = {}
			_table[colref.name] = 'item'
			const _join = {}
			_join[colref.name]] + '.detail@$type'] = type + '.' + colref.col
			_join[colref.name]] + '.@net'] = netdbid
			if (colref.nullable)
				items = items.leftJoin(_table, _join)
			else
				items = items.join(_table, _join)
		}
		if (type == 'user') {
			items = items
				.join('priv', 'item.dbid', 'priv.dbid')
		items = items
			.where('item.$type', type)
			.andWhere('item.@net', netdbid)
		if ('origdbid' in fields)
			items = items
				.andWhere('orig.dbid@item', fields.dbid)
		if ('id' in fields)
			items = items
				.andWhere('item.id', fields.id)
		for (col of schema.colsnonref) {
			if (!(col in fields)) continue
			item = items
				.andWhere(knex.ref(col).withSchema(type),
				          knex.ref(fields[col]))
		}
		for (colref in schema.colsref) {
			if (!(colref.name in fields) continue
			items = items
				.andWhere(colref.name + '.id', knex.ref(fields[parts[0]]))
		}
		console.log(items.toString())

		items = (await items).map(item => {
			const obj = {
				dbid: item.orig['dbid@item'],
				id: item.id,
				cust: item.cust
			}
			for (col of schema.colsnonref) {
				obj[col] = item[type][col]
			}
			for (colref of schema.colsref) {
				obj[colref.name] = item[colref.name].id
			}
			if (type == 'user') {
				obj.priv = item.priv.priv
			}
			return obj
		})
	}

	this.put = async function(type, netdbid, object)
	{
		// this creates a new object from the provided network

		const schema = schemas[type]
		await knex.transaction(async function(trx)
		{
			object.dbid = (await trx('item')
				.returning('dbid@item')
				.insert({
					'@net': netdbid,
					'detail@$type': 0,
					id: object.id,
					'$type': type,
					cust: object.cust
				}))[0]
			await trx('item').update({'detail@$type': object.dbid}).where('dbid@item', object.dbid)
			const details = {}
			for (colnonref of schema.colsnonref)
				if (colnonref in object)
					details[colnonref] = object[colnonref]
			for (colref of schema.colsref)
				if (colref.name in object)
					details[colref.name] = await trx('item')
						.first('dbid@item')
						.where('id', object[colref.name])
						.andWhere('@net', netdbid)
						.andWhere('$type', colref.ref)
			await trx(type).insert(details)
		})

		return object.dbid
	}

	this.mirror = async function(type, netdbid, origdbid, object)
	{
		object.dbid = (await knex('item')
			.returning('item.dbid')
			.insert({
				'@net': netdbid,
				'detail@$type': origdbid,
				id: object.id,
				'$type': type,
				cust: object.cust
			}))[0]
		return object.dbid
	}
}
