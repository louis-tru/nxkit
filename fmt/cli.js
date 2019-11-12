/* ***** BEGIN LICENSE BLOCK *****
 * Distributed under the BSD license:
 *
 * Copyright (c) 2015, xuewen.chu
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of xuewen.chu nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL xuewen.chu BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * ***** END LICENSE BLOCK ***** */

var path = require('../path');
var event = require('../event');
var cli = require('../ws/cli');
var uuid = require('../hash/uuid');
var errno = require('../errno');

/**
 * @class Client
 */
class WSClient extends cli.WSClient {

	constructor(host) {
		var url = host.m_url;
		var s = url.protocol == 'fmts:'? 'wss:': 'ws:';
				s += '//' + url.host + url.path;
		super('_fmt', new cli.Conversation(s));
		this.m_host = host;
		this.conv.onOpen.on(e=>{
			if (host.m_subscribe.size) {
				var events = [];
				for (var i of host.m_subscribe)
					events.push(i);
				this.weakCall('subscribe', {events});
			}
		});
	}

	/**
	 * @overwrite
	 */
	handleCall(method, data) {
		if (method in FMTClient.prototype) {
			throw Error.new(errno.ERR_FORBIDDEN_ACCESS);
		}
		var fn = this.m_host[method];
		if (typeof fn != 'function') {
			throw Error.new('"{0}" no defined function'.format(name));
		}
		return fn.call(this.m_host, data);
	}

}

/**
 * @class FMTClient
 */
class FMTClient extends event.Notification {

	get id() {
		return this.m_id;
	}

	get conv() {
		return this.m_cli.conv;
	}

	close() {
		this.conv.close();
	}

	constructor(id = uuid(), url = 'fmt://localhost/') {
		super();
		url = new path.URL(url);
		url.setParam('id', id);
		this.m_id = id;
		this.m_url = url;
		this.m_subscribe = new Set();
		this.m_cli = new WSClient(this, url);
	}

	subscribeAll() {
		this.m_cli.weakCall('subscribeAll');
	}

	unsubscribe(events = []) {
		events.forEach(e=>this.m_subscribe.delete(e));
		this.m_cli.weakCall('unsubscribe', {events});
	}

	subscribe(events = []) {
		events.forEach(e=>this.m_subscribe.add(e));
		this.m_cli.weakCall('subscribe', {events});
	}

	that(id) {
		utils.assert(id != this.id);
		return new ThatClient(this, id);
	}

	// @overwrite:
	getNoticer(name) {
		if (!this.hasNoticer(name)) {
			this.m_subscribe.add(name);
			this.m_cli.weakCall('subscribe', {events:[name]});
			this.m_cli.addEventListener(name, super.getNoticer(name)); // Forward event
		}
		return super.getNoticer(name);
	}

}

/**
 * @class ThatClient
 */
class ThatClient {
	get id() {
		return this.m_id;
	}
	constructor(host, id) {
		this.m_host = host;
		this.m_id = id;
	}
	hasOnline() {
		return this.m_host.call('hasOnline', { id: this.m_id });
	}
	trigger(event, data) {
		this.m_host.weakCall('triggerTo', { id: this.m_id, event, data });
	}
	call(method, data, timeout = cli.METHOD_CALL_TIMEOUT) {
		return this.m_host.call('callTo', { id: this.m_id, method, data, timeout }, timeout);
	}
	weakCall(method, data) {
		this.m_host.weakCall('weakCallTo', { id: this.m_id, method, data });
	}
}

module.exports = {
	FMTClient,
};