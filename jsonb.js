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

var errno = require('./errno');
var utils = require('./util');
var buffer = require('./_buffer');
var codec = require('./_codec');
var TypedArray = Uint8Array.prototype.__proto__.constructor;

var // FLAGS
	F_EOF = 0,
	F_STRING = 1, // utf8 encoded
	F_BUFFER = 2,
	F_INT_8 = 3,
	F_UINT_8 = 4,
	F_INT_16 = 5,
	F_UINT_16 = 6,
	F_INT_32 = 7,
	F_UINT_32 = 8,
	F_INT_64 = 9,
	F_UINT_64 = 10,
	F_FLOAT_NUM_32 = 11,
	F_FLOAT_NUM_64 = 12,
	F_BIGINT = 13,
	F_BIGINT_NEGATIVE = 14,
	F_NULL = 15,
	F_TRUE = 16,
	F_FALSE = 17,
	F_DATE = 18,
	F_OBJECT = 19,
	F_ARRAY = 20,
	F_OBJECT_END = 21,
	F_ARRAY_END = 22,
	F_UNDEFAULT = 23,
	F_NAN = 24,
	F_INFINITY_MIN = 25,
	F_INFINITY_MAX = 26;

var BIGINT_MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
var BIGINT_MIN_SAFE_INTEGER = BigInt(Number.MIN_SAFE_INTEGER);

function write_flag(flag, out) {
	out.push([flag]);
	return 1;
}

function write_buffer(data, out) {
	/*
		0   - 253   : 1,	len|data...
		254 - 65536 : 3,	254|len|len|data...
		65537 -     : 9,	255|len|len|len|len|len|len|len|len|data...
	*/
	var dataLength = data.length;
	var secondByte = dataLength;
	var headerLength = 1;

	if (dataLength > 65536) {
		headerLength += 8;
		secondByte = 255;
	} else if (dataLength > 253) {
		headerLength += 2;
		secondByte = 254;
	}
	// write header:
	var index = 0;
	var header = new Uint8Array(headerLength);
	header[index] = secondByte; index++; // secondByte

	// write data length header:
	switch (secondByte) {
		case 254:
			header[index] = dataLength >> 8; index++;
			header[index] = dataLength % 256; index++;
			break;
		case 255:
			var l = dataLength;
			for (var i = index + 7; i >= index; i--) {
				header[i] = l & 0xff;
				l >>= 8;
			}
			index += 8;
	}

	out.push(header);
	out.push(data);

	return headerLength + dataLength;
}

function write_num(o, api, len, out) {
	var b = new Uint8Array(len);
	buffer[api](b, o)
	out.push(b);
	return len;
}

function isFloat32(o) {
	// float32: S 08-     EEEEEEEE 23>                                  DDDDDDD DDDDDDDD DDDDDDDD
	// float64: S 11- EEE EEEEEEEE 52- DDDD DDDDDDDD DDDDDDDD DDDDDDDD DDDDDDDD DDDDDDDD DDDDDDDD
	return false;
}

function write_number(o, out) {
	if (Number.isInteger(o)) { // Integer
		// Int8   意思是8位整数(8bit integer),    相当于 char       占1个字节   -128 ~ 127
		// Int16  意思是16位整数(16bit integer),  相当于 short      占2个字节   -32768 ~ 32767
		// Int32  意思是32位整数(32bit integer),  相当于 int        占4个字节   -2147483648 ~ 2147483647
		// Int64  意思是64位整数(64bit interger), 相当于 long long  占8个字节   -9223372036854775808 ~ 9223372036854775807
		if (o < 0) {
			if (o > -129) { // int8
				return write_flag(F_INT_8, out) + write_num(o, 'writeInt8', 1, out);
			} else if (o > -32769) { // int16
				return write_flag(F_INT_16, out) + write_num(o, 'writeInt16BE', 2, out);
			} else if (o > -2147483649) { // int32
				return write_flag(F_INT_32, out) + write_num(o, 'writeInt32BE', 4, out);
			} else { // int64, javascript use double float
				return write_flag(F_FLOAT_NUM_64, out) + write_num(o, 'writeDoubleBE', 8, out);
			}
		} else {
			if (o < 256) { // uint8 0xff + 1
				return write_flag(F_UINT_8, out) + write_num(o, 'writeUInt8', 1, out);
			} else if (o < 65536) { // uint16 0xffff + 1
				return write_flag(F_UINT_16, out) + write_num(o, 'writeUInt16BE', 2, out);
			} else if (o < 4294967296) { // uint32 0xffffffff + 1
				return write_flag(F_UINT_32, out) + write_num(o, 'writeUInt32BE', 4, out);
			} else { // uint64, javascript use double float
				return write_flag(F_FLOAT_NUM_64, out) + write_num(o, 'writeDoubleBE', 8, out);
			}
		}
	}
	if (isFloat32(o)) { // Float 32/64
		return write_flag(F_FLOAT_NUM_32, out) + write_num(o, 'writeFloatBE', 4, out);
	} else {
		return write_flag(F_FLOAT_NUM_64, out) + write_num(o, 'writeDoubleBE', 8, out);
	}
}

function write_bigint(o, out) {
	if (o < BIGINT_MAX_SAFE_INTEGER && o > BIGINT_MIN_SAFE_INTEGER) {
		return write_number(Number(o), out);
	}
	if (o < 0n) { // 
		write_flag(F_BIGINT_NEGATIVE, out);
		o = -o;
	} else {
		write_flag(F_BIGINT, out);
	}
	var bytes = [], i = 0;
	do {
		bytes.push(Number(o & 0xffn));
		o >>= 8n;
		i++;
	} while(o || i < 8);

	return 1 + write_buffer(bytes.reverse(), out);
}

function write_array(o, out) {
	var l = 0;
	for (var val of o) {
		l += serialize(val, out);
	}
	return l;
}

function write_object(o, out) {
	var l = 0;
	for (var key in o) {
		l += serialize(key, out);
		l += serialize(o[key], out);
	}
	return l;
}

function serialize(o, out) {
	switch (typeof o) {
		case 'string':
			return write_flag(F_STRING, out) + write_buffer(codec.encodeUTF8(o), out);
		case 'number':
			if (Number.isNaN(o)) {
				return write_flag(F_NAN, out);
			} else if (o === Infinity) {
				return write_flag(F_INFINITY_MAX, out);
			} else if (o === -Infinity) {
				return write_flag(F_INFINITY_MIN, out);
			} else {
				return write_number(o, out);
			}
		case 'boolean':
			return write_flag(o ? F_TRUE: F_FALSE, out);
		case 'bigint':
			return write_bigint(o, out);
		case 'object':
			if (!o) {
				return write_flag(F_NULL, out);
			} else if (Array.isArray(o)) {
				return write_flag(F_ARRAY, out) + write_array(o, out) + write_flag(F_ARRAY_END, out);
			} else if (o instanceof Uint8Array) {
				return write_flag(F_BUFFER, out) + write_buffer(o, out);
			} else if (o instanceof TypedArray) {
				return write_flag(F_BUFFER, out) + write_buffer(new Uint8Array(o.buffer), out);
			} else if (o instanceof ArrayBuffer) {
				return write_flag(F_BUFFER, out) + write_buffer(new Uint8Array(o), out);
			} else if (o instanceof Date) {
				return write_flag(F_DATE, out) + write_num(o.valueOf(), 'writeInt48BE', 6, out);
			} else {
				return write_flag(F_OBJECT, out) + write_object(o, out) + write_flag(F_OBJECT_END, out);
			}
		case 'undefined':
			return write_flag(F_UNDEFAULT, out);
		default: // default use string
			return write_flag(F_STRING, out) + write_buffer(codec.encodeUTF8(String(o)), out);
	}
}

function binaryify(o) {
	var output = [];
	var byteLen = serialize(o, output);
	var offset = 0;
	var rev = new Uint8Array(byteLen);
	for (var bytes of output) {
		rev.set(bytes, offset);
		offset += bytes.length;
	}
	return rev;
}

// parse binary:

class Binary {
	get value() {
		return this.d[this.index];
	}
	get length() {
		return this.d.length;
	}
	constructor(buf) {
		this.d = buf;
		this.index = 0;
	}
	next() {
		var v = this.d[this.index];
		this.index++;
		return v;
	}
	has(flag) {
		return this.value == flag;
	}
	isEOF() {
		return this.index >= this.d.length;
	}
}

function assert(cond) {
	utils.assert(cond, errno.ERR_UNABLE_PARSE_JSONB);
}

function read_object(bin) {
	var rev = {};
	do {
		if (bin.has(F_OBJECT_END)) {
			bin.next(); break;
		} else {
			var key = read_next(bin);
			rev[key] = read_next(bin);
		}
	} while(true);
	return rev;
}

function read_array(bin) {
	var rev = [];
	do {
		if (bin.has(F_ARRAY_END)) {
			bin.next(); break;
		} else {
			rev.push(read_next(bin));
		}
	} while(true);
	return rev;
}

function read_buffer(bin) {
	/*
		0   - 253   : 1,	len|data...
		254 - 65536 : 3,	254|len|len|data...
		65537 -     : 9,	255|len|len|len|len|len|len|len|len|data...
	*/
	var dataLen = bin.next(), end;
	if (dataLen < 254) { // 0 - 253 byte length
		end = bin.index + dataLen;
	} else if (dataLen < 255) { // 254 - 65536 byte length
		assert(bin.length > bin.index + 2);
		dataLen = (bin.next() << 8) | bin.next();
		end = bin.index + dataLen;
	} else { // 65537 - byte length
		assert(bin.length > bin.index + 8);
		dataLen = 0;
		for (var i = 0; i < 8; i++) {
			dataLen |= bin.next();
			dataLen <<= 8;
		}
		end = bin.index + dataLen;
	}
	assert(bin.length >= end);
	var d = bin.d.slice(bin.index, end);
	bin.index = end;
	return d;
}

function read_num(bin, api, len) {
	var r = buffer[api](bin.d, bin.index);
	bin.index += len;
	return r;
}

function read_bigint(bin) {
	assert(bin.length > bin.index + 8);
	var num = 0n;
	var bytes = read_buffer(bin);
	for (var byte of bytes) {
		num <<= 8n;
		num |= BigInt(byte);
	}
	return num;
}

function read_next(bin) {
	switch (bin.next()) {
		case F_STRING:
			return codec.decodeUTF8(read_buffer(bin));
		case F_BUFFER:
			return read_buffer(bin);
		case F_INT_8:
			return read_num(bin, 'readInt8', 1);
		case F_UINT_8:
			return read_num(bin, 'readUInt8', 1);
		case F_INT_16:
			return read_num(bin, 'readInt16BE', 2);
		case F_UINT_16:
			return read_num(bin, 'readUInt16BE', 2);
		case F_INT_32:
			return read_num(bin, 'readInt32BE', 4);
		case F_UINT_32:
			return read_num(bin, 'readUInt32BE', 4);
		case F_INT_64:
			return read_num(bin, 'readBigInt64BE', 8);
		case F_UINT_64:
			return read_num(bin, 'readBigUInt64BE', 8);
		case F_FLOAT_NUM_32:
			return read_num(bin, 'readFloatBE', 4);
		case F_FLOAT_NUM_64:
			return read_num(bin, 'readDoubleBE', 8);
		case F_BIGINT:
			return read_bigint(bin);
		case F_BIGINT_NEGATIVE:
			return -read_bigint(bin);
		case F_TRUE:
			return true;
		case F_FALSE:
			return false;
		case F_DATE:
			return new Date(read_num(bin, 'readUInt48BE', 6));
		case F_OBJECT:
			return read_object(bin);
		case F_ARRAY:
			return read_array(bin);
		case F_NULL:
			return null;
		case F_UNDEFAULT:
			return undefined;
		case F_NAN:
			return NaN;
		case F_INFINITY_MIN:
			return -Infinity;
		case F_INFINITY_MAX:
			return Infinity;
		default:
			assert(0);
	}
}

function parse(buf) {
	return read_next(new Binary(buf));
}

module.exports = {
	binaryify,
	parse,
};