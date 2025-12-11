# DNSCP - DNS Consensus Proxy
DNSCP is a DNS proxy server that behaves like a regular DNS server listening on UDP and TCP port 53. It forwards A and AAAA record queries to a random selection of DoH servers (DNS Over HTTPS) and returns a result for which there is consensus about the answer. Using DoH ensures that your DNS requests are encrypted, and by querying random servers for every request ensures that no single DNS server will know every domain that you are looking up. The consensus based logic adds a layer of resilience against DNS poisoning, NXDOMAIN hijacking and censorship. If it is not possible to reach consensus, for instance if a domain uses round-robin DNS, the first result is returned. DNSCP relies on the [dns2](https://github.com/lsongdev/node-dns/) library for its DNS and DoH protocol handling.

Features:
* Adds DoH capability to a single device or an entire network
* Enhanced privacy by using DoH and distributing DNS queries to different servers
* Resilience against DNS poisoning, NXDOMAIN hijacking and censorship
* Minimal performance overhead by returning the result as soon as consensus is established, without waiting for all upstream DoH servers to reply
* Hosts file support

Limitations:
* Consensus is only supported for A and AAAA records. 
*Other query types, such as MX, will be forwarded the response from a random DoH server*

## Configuration
`index.js` contains the following default settings, which you can change as you see fit:
* **numberOfServersToAsk**: How many external DNS servers should be asked for each query (default 4)
* **minimumForConsensus**: How many external DNS servers must agree on the answer to a query to establish consensus (default 2)
* **serverTimeout**: How many ms to wait for an external DNS server to reply (default 2000)
* **cacheLimit**: How many DNS query results should be cached (default 5000)
* **cacheTTL**: How many seconds is a cached DNS query valid (default 600)

The list of possible DoH servers is contained within the file `dohservers`. Use `#` for comments. 

DNSCP supports a basic `hosts` file like Linux and Windows, with the classic format of [ip]<space>[domain] and comments preceded by `#`, e.g.:

    192.168.1.100 somerandomexampledomain.com
    
## Usage
Run `npm install` followed by `node index.js`. The `hosts` file and `dohservers` file are read once during start - restart DNSCP for any changes to the files to take effect.

### Example: Using a Raspberry PI with Raspberry PI OS as a local network DNS server using DNSCP
Using DoH requires a regular DNS server to look up the DoH domain. A simple way to ensure that this is possible, is to configure which DNS server the Raspberry PI should use:

    sudo nano /etc/systemd/resolved.conf
    
Add the following line:

    static domain_name_servers=194.242.2.2 86.54.11.100
    
This example points to Mullvad and DNS4EU DNS servers, but you can use whichever DNS servers you prefer.

Afterwards you can start the DNSCP server and configure your router to use it. You can use for instance PM2 to ensure that DNSCP starts automatically during start up.
