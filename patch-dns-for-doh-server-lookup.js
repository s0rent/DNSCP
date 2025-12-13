const fs = require('node:fs');
const dns = require('dns');

const originalDnsLookupMethod = dns.lookup;
const DoHServerHostNames = [];
const customDnsResolver = new dns.Resolver();
customDnsResolver.setServers(['1.1.1.1', '8.8.8.8']);

if (fs.existsSync('./dohservers')) {
    const lines = fs.readFileSync('./dohservers','utf-8').split(/\r?\n/);
    for (let line of lines) {
        line = line.trim();
        if(line && line.charAt(0) !== '#') {
            DoHServerHostNames.push((new URL(line)).hostname);
        }
    }
}

dns.lookup = (hostname, options, callback) => {
    if (DoHServerHostNames.includes(hostname)) {
        customDnsResolver.resolve4(hostname, (err, addresses) => {
            if (err || addresses.length === 0) {
                callback(err);
            }
            if (options?.all === true) {
                const results = addresses.map(addr => ({ address: addr, family: 4 }));
                callback(null, results); 
                
            } else {
                callback(null, addresses[0], 4); 
            }
        });
    } else {
        return originalDnsLookupMethod(hostname, options, callback);
    }
};
