MetaShare is a project to combine communication networks.

The approach is a single library that abstracts the process of bridging a network,
and bridge implementations for a set of networks that are easy to deploy.

Explanation From Small Review 2020-03-09:
	It looks like each bridge is a single-async-function module that takes a Context and resolves to an interface object:
		{
			"put": takes a (type, object) to broadcast to the network
			"sync": downloads changes from the network [expected to process all history since last call, even if system was offline]
		}
	
