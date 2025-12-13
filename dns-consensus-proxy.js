const { DOHClient, Packet, createServer } = require('dns2');
const fs = require('node:fs');
const { open } = require('node:fs/promises');

class DNSConsensusProxy {
    constructor(settings) {
        this.numberOfServersToAsk = settings.numberOfServersToAsk || 4;
        this.minimumForConsensus = settings.minimumForConsensus || 2;
        this.cacheLimit = settings.cacheLimit || 2000;
        this.cacheTTL = settings.cacheTTL || 600;

        this.DoHAddresses = [];
        this.hosts = {};
        this.cache = [];
        this.DoHClients = [];
    }

    makeCacheKey(q) {
        return `${q.name}:${q.type}:${q.class}`;
    }

    makeAnswersKey(a) {
        if (a && a.length) {
            // There are answers, sort them to ensure that the same key is made for the same list of answers
            const addresses = a.map(a => a.address);
            addresses.sort((a,b) => {
                if (a > b) return 1;
                if (a < b) return -1;
                return 0;
            });
            return addresses.join('|');
        }
        return 'NoAnswer'; // There is no answer, either because there is no such domain or no A/AAAA record
    }

    async loadConfigFiles() {
        // No validation, your files better be good!
        // Read hosts file
        try{
            if (fs.existsSync('./hosts')) {
                const hostsFile = await open('./hosts');
                for await (const line of hostsFile.readLines()) {
                    if (line && line.trim().charAt(0) !== '#') {
                        const parts = line.split(' ').map(l => l.trim()).filter(l => l);
                        this.hosts[parts[1]] = parts[0];
                    }
                }
            }
        } catch (err){
            console.warn('hosts file could not be parsed: ', err);
        }
        // Read dohservers file
        try {
            if (fs.existsSync('./dohservers')) {
                const dohservers = await open('./dohservers');
                for await (let line of dohservers.readLines()) {
                    line = line.trim();
                    if (line && line.charAt(0) !== '#') {
                        this.DoHAddresses.push(line);
                    }
                }
                this.DoHClients.push(...this.DoHAddresses.map(address => {
                    return DOHClient({
                        dns: address
                    });
                }));
            } else {
                console.error('Required file "dohservers" not found.');
                process.exit(1);
            }
        } catch (err){
            console.error('Error creating DoHClients for servers listed in "dohservers" file: ', err);
            process.exit(1);
        }
    }

    sendResult(send, request, result, cacheKey = null) {
        if (cacheKey) {
            this.cache.push({
                key: cacheKey,
                result: result,
                time: new Date().getTime()
            });
            while (this.cache.length > this.cacheLimit) {
                this.cache.shift();
            }
        }
        result.header.id = request.header.id;
        send(result);
    }

    sendError(send, request) {
        const response = Packet.createResponseFromRequest(request);
        response.header.rcode = Packet.RCODE.SERVFAIL;
        send(response);
    }

    checkForConsensus(queryResult, send, request, cacheKey) {
        if (queryResult.consensus) return;
        if (queryResult.results.length >= this.minimumForConsensus) {
            const answersMap = {};
            queryResult.results.forEach(result => {
                if (result) {
                    const key = this.makeAnswersKey(result.answers);
                    answersMap[key] = (answersMap[key] ?? 0) + 1;
                    result.key = key;
                }
            });

            const consensusKey = Object.keys(answersMap).find(key => answersMap[key] >= this.minimumForConsensus);
            if (consensusKey) {
                // Consensus established, send the result and save it in cache
                queryResult.consensus = true;
                const result = queryResult.results.find(qr => qr?.key === consensusKey);
                delete result.key;
                this.sendResult(send, request, result, cacheKey);
            } else if (queryResult.results.length === this.numberOfServersToAsk) {
                // No consensus after all results are in
                const filteredResults = queryResult.results.filter(r => r); // Remove null values
                if (filteredResults.length) {
                    // There is one or more result, send the first one
                    delete filteredResults[0].key;
                    this.sendResult(send, request, filteredResults[0]);
                } else {
                    // All results were errors
                    this.sendError(send, request);
                }
            }
        }
    }

    handle(request, send) {
        const [ question ] = request.questions;
        const questionType = Object.keys(Packet.TYPE).find(t => {
            return Packet.TYPE[t] === question.type;
        });
        const queryResult = {
            consensus: false,
            results: []
        };

        if (![Packet.TYPE.A, Packet.TYPE.AAAA].includes(question.type) || question.class !== Packet.CLASS.IN) {
            // The DNS query is not supported by the consensus implementation, just behave as a basic proxy and ask a random DNS server
            this.DoHClients[Math.floor(Math.random() * this.DoHClients.length)](question.name, questionType, question.class)
                .then(result => {
                    result.header.id = request.header.id;
                    send(result);
                })
                .catch(err => {
                    console.log(err);
                    this.sendError(send, request);
                });
        } else {
            // First check against hosts
            if (this.hosts[question.name]) {
                const response = Packet.createResponseFromRequest(request);
                const { name } = question.name;
                response.answers.push({
                    name,
                    type: question.type,
                    class: question.class,
                    ttl: this.cacheTTL,
                    address: this.hosts[question.name]
                })
                response.header.ancount = 1;
                response.header.arcount = 0;
                response.header.z = 0;
                response.header.aa = 1;
                send(response);
                return;
            }

            const cacheKey = this.makeCacheKey(question);
            const cached = this.cache.find(cacheElement => cacheElement.key === cacheKey);

            if (cached && cached.time + (this.cacheTTL*1000) > new Date().getTime()) {
                // There is a cached result and it is not too old
                this.sendResult(send, request, cached.result);
            } else {
                // There is no cached result or it is too old - Query a number of random DNS servers
                let DoHClientsIndexes = [];
                while (DoHClientsIndexes.length < Math.min(this.numberOfServersToAsk, this.DoHClients.length)) {
                    DoHClientsIndexes.push(Math.floor(Math.random() * this.DoHClients.length));
                    DoHClientsIndexes = [...new Set(DoHClientsIndexes)]
                }

                DoHClientsIndexes.forEach(i => {
                    this.DoHClients[i](question.name, questionType, question.class)
                        .then(result => {
                            queryResult.results.push(result);
                        })
                        .catch(err => {
                            console.log(err);
                            queryResult.results.push(null);
                        })
                        .finally(() => {
                            this.checkForConsensus(queryResult, send, request, cacheKey);
                        });
                });
            }
        }
    }

    listen() {
        const server = createServer({
            udp : true,
            tcp : true,
            handle: this.handle.bind(this)
        });

        this.loadConfigFiles().then(() => {
            server.listen({
                udp: {
                    port: 53,
                },
                tcp: {
                    port: 53,
                },
            });
        });
    }
}

module.exports = DNSConsensusProxy;
