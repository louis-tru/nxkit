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

import util from './util';
import * as fs from './fs';
import service, {Service} from './service';
import * as http from 'http';
import * as zlib from 'zlib';

var g_static_cache: Any = {};

type RouterInfo = Any;

//set util
function setHeader(self: StaticService, expires?: number) {
	var res = self.response;
	res.setHeader('Server', 'Ngui utils');
	res.setHeader('Date', new Date().toUTCString());
	if (self.request.method == 'GET') {
		expires = expires === undefined ? self.server.expires : expires;
		if (expires) {
			if (!(<any>self).m_no_cache/*!res.headers['Cache-Control'] && !res.headers['Expires']*/) {
				// console.log(new Date().addMs(6e4 * expires).toUTCString());
				res.setHeader('Expires', new Date().add(6e4 * expires).toUTCString());
				res.setHeader('Cache-Control', 'public, max-age=' + (expires * 60));
			}
		}
	}
	res.setHeader('Access-Control-Allow-Origin', self.server.allowOrigin);
}

function getContentType(self: StaticService, baseType: string){
	if(/javascript|text|json|xml/i.test(baseType)){
		return baseType + '; charset=' + self.server.textEncoding;
	}
	return baseType;
}

// 文件是否可支持gzip压缩
function isGzip(self: StaticService, filename: string) {
	if(!self.server.gzip){
		return false;
	}
	var ae = <string>self.request.headers['accept-encoding'];
	var type = self.server.getMime(filename);

	return !!(ae && ae.match(/gzip/i) && type.match(self.server.gzip));
}

//返回目录
function tryReturnDirectory(self: StaticService, filename: string) {

	//读取目录
	if (!filename.match(/\/$/))  // 目录不正确,重定向
		return returnRedirect(self, self.pathname + '/');

	//返回目录
	function result(self: StaticService, filename: string) {
		if(self.server.autoIndex) {
			return returnDirectory(self, filename);
		} else {
			return returnErrorStatus(self, 403);
		}
	}

	var def = self.server.defaults;
	if (!def.length) { //默认页
		return result(self, filename);
	}

	fs.readdir(filename, function (err, files) {
		if (err) {
			console.log(err);
			return returnErrorStatus(self, 404);
		}
		for (var i = 0, name; (name = def[i]); i++) {
			if (files.indexOf(name) != -1)
				return returnFile(self, filename.replace(/\/?$/, '/') + name);
		}
		result(self, filename);
	});
}

function returnRedirect(self: StaticService, path: string) {
	self.response.setHeader('Location', path);
	self.response.writeHead(302);
	self.response.end();
}

function returnDirectory(self: StaticService, filename: string) {
	var res = self.response;
	var req = self.request;

	//读取目录
	if (!filename.match(/\/$/)){  //目录不正确,重定向
		return returnRedirect(self, self.pathname + '/');
	}

	fs.list(filename, function (err, files) {
		if (err) {
			return returnErrorStatus(self, 404);
		}
		var	dir = filename.replace((<any>self)._root, '');
		var html =
			String.format(
			'<!DOCTYPE html><html><head><title>Index of {0}</title>', dir) +
			'<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />' +
			'<style type="text/css">*{font-family:Courier New}div,span{line-height:20px;height:20px;}\
			span{display:block;float:right;width:220px}</style>' +
			'</head><body bgcolor="white">' +
			String.format(
			'<h1>Index of {0}</h1><hr/><pre><div><a href="{1}">../</a></div>', dir, dir ? '../' : 'javascript:')

		var ls1 = [];
		var ls2 = [];

		for (var stat of <fs.StatsDescribe[]>files) {
			var name = stat.name;
			if (name.slice(0, 1) == '.'){
				continue;
			}
			var link = name;
			var size = (stat.size / 1024).toFixed(2) + ' KB';
			var isdir = stat.isDirectory();

			if (isdir) {
				link += '/';
				size = '-';
			}
			var s = String.format(
				'<div><a href="{0}">{0}</a><span>{2}</span><span>{1}</span></div>',
					link, stat.ctime.toString('yyyy-MM-dd hh:mm:ss'), size);
			isdir ? ls1.push(s) : ls2.push(s);
		}

		html += ls1.join('') + ls2.join('') + '</pre><hr/></body></html>';
		setHeader(self);

		// var type = self.server.getMime('html');
		
		res.writeHead(200);
		res.end(html);
	});
}

//返回缓存
function return_cache(self: StaticService, filename: string) {
	var cache = g_static_cache[filename];

	if ( cache && cache.data ) {
		var req = self.request;
		var res = self.response;
		var type = self.server.getMime(filename);
		var ims = <string>req.headers['if-modified-since'];
		var mtime = <Date>cache.time;

		setHeader(self);

		res.setHeader('Last-Modified', mtime.toUTCString());
		res.setHeader('Content-Type', getContentType(self, type));
		if (cache.gzip) {
			res.setHeader('Content-Encoding', 'gzip');
		}
		res.setHeader('Content-Length', cache.size);

		if (ims && Math.abs(new Date(ims).valueOf() - mtime.valueOf()) < 1000) { //使用 304 缓存
			res.writeHead(304);
			res.end();
		}
		else {
			res.writeHead(200);
			res.end(cache.data);
		}
		return true;
	}
	return false;
}

//返回数据
function result_data(
	self: StaticService, 
	filename: string, 
	type: string, 
	time: Date, 
	gzip: boolean, 
	err: any, 
	data: Buffer
) 
{
	if (err) {
		delete g_static_cache[filename];
		return returnErrorStatus(self, 404);
	}

	var res = self.response;
	var cache = { 
		data: data, 
		time: time, 
		gzip: gzip, 
		size: data.length 
	};
	if ( self.server.fileCacheTime ) { // 创建内存缓存
		g_static_cache[filename] = cache;
		setTimeout(function () { delete cache.data; }, self.server.fileCacheTime * 1e3);
	}
	if (gzip) {
		res.setHeader('Content-Encoding', 'gzip');
	}
	res.setHeader('Content-Length', data.length);
	res.setHeader('Content-Type', getContentType(self, type));
	res.writeHead(200);
	res.end(data);
}

// 返回文件数据范围
function resultFileData(
	self: StaticService, 
	filename: string, 
	type: string, 
	size: number, 
	start_range: number, 
	end_range: number
) 
{
	var res = self.response;
	var end = false;
	var read: fs.ReadStream;
	res.setHeader('Content-Type', getContentType(self, type));

	if (start_range != -1 && end_range != -1) {
		res.setHeader('Content-Length', end_range - start_range);
		res.setHeader('Content-Range', `bytes ${start_range}-${end_range-1}/${size}`);
		res.writeHead(206);
		if (start_range >= end_range) {
			return res.end();
		}
		read = fs.createReadStream(filename, { start: start_range, end: end_range - 1 });
	} else {
		res.setHeader('Content-Length', size);
		res.writeHead(200);
		read = fs.createReadStream(filename);
	}

	read.on('data', function (buff) {
		res.write(buff);
	});
	read.on('end', function () {
		end = true;
		res.end();
	});
	read.on('error', function (e) {
		read.destroy();
		console.error(e);
		end = true;
		res.end();
	});
	res.on('error', function () {
		if(!end){ // 意外断开
			end = true;
			read.destroy();
		}
	});
	res.on('close', function () { // 监控连接是否关闭
		if(!end){ // 意外断开
			end = true;
			read.destroy();
		}
	});
}

//返回异常状态
function resultError(self: StaticService, statusCode: number, html?: string) {
	var res = self.response;
	var type = self.server.getMime('html');

	setHeader(self);
	res.setHeader('Content-Type', getContentType(self, type));
	res.writeHead(statusCode);
	res.end('<!DOCTYPE html><html><body><h3>' +
		statusCode + ': ' + (http.STATUS_CODES[statusCode] || '') +
		'</h3><br/>' + (html || '') + '</body></html>');
}

function returnErrorStatus(self: StaticService, statusCode: number, html?: string) {
	var filename = self.server.errorStatus[statusCode];
	
	if (filename) {
		filename = (<any>self)._root + filename;
		fs.stat(filename, function (err) {
			if (err) {
				resultError(self, statusCode, html);
			} else {
				if (util.dev && html) {
					resultError(self, statusCode, html);
				} else {
					returnFile(self, filename);
				}
			}
		});
	} else {
		resultError(self, statusCode, html);
	}
}

function returnFile(self: StaticService, filename: string) {
		
	var req = self.request;
	var res = self.response;
	
	if (!util.dev && return_cache(self, filename)) {  //high speed Cache
		return;
	}
	
	fs.stat(filename, function (err, stat) {
		
		if (err) {
			return returnErrorStatus(self, 404);
		}
		
		if (stat.isDirectory()) {  //dir
			return tryReturnDirectory(self, filename);
		}
		
		if (!stat.isFile()) {
			return returnErrorStatus(self, 404);
		}
		
		//for file
		if (stat.size > self.server.maxFileSize) { //File size exceeds the limit
			return returnErrorStatus(self, 403);
		}
		
		var mtime = <Date>stat.mtime;
		var ims = req.headers['if-modified-since'];
		var range = <string>req.headers['range'];
		var type = self.server.getMime(filename);
		var gzip = isGzip(self, filename);
		
		setHeader(self);
		res.setHeader('Last-Modified', mtime.toUTCString());
		res.setHeader('Accept-Ranges', 'bytes');

		if (range) { // return Range
			if (range.substr(0, 6) == 'bytes=') {
				var ranges = range.substr(6).split('-');
				var start_range = ranges[0] ? Number(ranges[0]) : 0;
				var end_range = ranges[1] ? Number(ranges[1]) : stat.size - 1;
				if (isNaN(start_range) || isNaN(end_range)) {
					return returnErrorStatus(self, 400);
				}
				if (!ranges[0]) { // 选择文件最后100字节  bytes=-100
					start_range = Math.max(0, stat.size - end_range);
					end_range = stat.size - 1;
				}
				end_range++;
				end_range = Math.min(stat.size, end_range);
				start_range = Math.min(start_range, end_range);
				// var ir = req.headers['if-range'];
				// if (ir && Math.abs(new Date(ims) - mtime) < 1000) {
				// }
				return resultFileData(self, filename, type, stat.size, start_range, end_range);
			}
		}

		if (ims && Math.abs(new Date(ims).valueOf() - mtime.valueOf()) < 1000) { //use 304 cache
			res.setHeader('Content-Type', getContentType(self, type));
			res.writeHead(304);
			res.end();
			return;
		}
		
		if (stat.size > 5 * 1024 * 1024) { // 数据大于5MB使用这个函数处理
			return resultFileData(self, filename, type, stat.size, -1, -1);
		}
		else if ( ! gzip ) { //no use gzip format
			return fs.readFile(filename, function(err, data) {
				result_data(self, filename, type, mtime, false, err, data);
			});
		}
		
		fs.readFile(filename, function(err, data) {
			if (err) {
				console.error(err);
				return returnErrorStatus(self, 404);
			}
			zlib.gzip(data, function (err, data) {        		//gzip
				result_data(self, filename, type, mtime, true, err, data);
			});
		});
	});
}

/**
 * @class StaticService
 */
export class StaticService extends Service {
	// @private:
	// private m_root: string;
	private m_no_cache: boolean | undefined;
	protected _response_ok: boolean | undefined;

	private get _root(): string {
		return <any>this.server.root
	}

	// @public:
	/**
	 * response of server
	 * @type {http.ServerRequest}
	 */
	readonly response: http.ServerResponse;

	/**
	 * @constructor
	 * @arg req {http.ServerRequest}
	 * @arg res {http.ServerResponse}
	 * @arg info {Object}
	 */
	constructor(req: http.IncomingMessage, res: http.ServerResponse) {
		super(req);
		this.response = res;
		// this.m_root = <any>this.server.root; //.substr(0, this.server.root.length - 1);
		// this.setTimeout(this.server.timeout * 1e3);
	}
	
	/** 
	 * @overwrite
	 */
	action(info: RouterInfo) {
		var method = this.request.method;
		if (method == 'GET' || method == 'HEAD') {
			
			var filename = this.pathname;
			var virtual = this.server.virtual;
			
			if (virtual) { //是否有虚拟目录
				var index = filename.indexOf(virtual + '/');
				if (index === 0) {
					filename = filename.substr(virtual.length);
				} else {
					return this.returnErrorStatus(404);
				}
			}
			if (this.server.disable.test(filename)) {  //禁止访问的路径
				return this.returnErrorStatus(403);
			}
			this.returnFile(this._root + filename);
		} else {
			this.returnErrorStatus(405);
		}
	}

	/**
	 * @func markResponse
	 */
	markResponse() {
		if (this._response_ok)
			throw new Error('request has been completed');
		this._response_ok = true;
	}

	/**
	 * returnRedirect
	 * @param {String} path
	 */
	returnRedirect(path: string) {
		this.markResponse();
		returnRedirect(this, path);
	}
	
	/**
	 * return the state to the browser
	 * @param {Number} statusCode
	 * @param {String} text (Optional)  not default status ,return text
	 */
	returnErrorStatus(statusCode: number, html?: string) {
		this.markResponse();
		returnErrorStatus(this, statusCode, html);
	}
	
	/**
	 * 返回站点文件
	 */
	returnSiteFile(name: string) {
		this.markResponse();
		return returnFile(this, this.server.root + '/' + name);
	}

	isAcceptGzip(filename: string) {
		if (this.server.gzip) {
			var ae = <string>this.request.headers['accept-encoding'];
			return !!(ae && ae.match(/gzip/i));
		}
		return false;
	}

	isGzip(filename: string) {
		return isGzip(this, filename);
	}
	
	setDefaultHeader(expires?: number) {
		setHeader(this, expires);
	}

	setNoCache() {
		this.m_no_cache = true;
		this.response.setHeader('Cache-Control', 'no-cache');
		this.response.setHeader('Expires', '-1');
	}
	
	/**
	 * return file to browser
	 * @param {String}       filename
	 */	
	returnFile(filename: string) {
		this.markResponse();
		return returnFile(this, filename);
	}
	
	/**
	 * return dir
	 * @param {String}       filename
	 */
	returnDirectory(filename: string) {
		this.markResponse();
		return returnDirectory(this, filename);
	}

	// @end
}

service.set('StaticService', StaticService);