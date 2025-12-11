const DNSConsensusProxy = require('./dns-consensus-proxy');

const settings = {
    numberOfServersToAsk : 4,     // How many external DNS servers should be asked for each query
    minimumForConsensus : 2,      // How many external DNS servers must agree on the answer to a query to establish consensus
    serverTimeout : 2000,         // How many ms to wait for an external DNS server to reply
    cacheLimit : 5000,            // How many DNS query results should be cached
    cacheTTL : 600,               // How many seconds is a cached DNS query valid
}

const DNSConsensusProxyServer = new DNSConsensusProxy(settings);
DNSConsensusProxyServer.listen();
