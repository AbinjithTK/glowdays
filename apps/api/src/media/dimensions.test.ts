/**
 * Image header tests.
 *
 * The tier boundary is the point of these. A photo one pixel short of 1080 must
 * come back as SD, because a scan mislabelled HD would later be compared
 * against a real HD scan and the confidence engine would have no way to know.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { maskPng } from '../dev/png.js';
import {
  MIN_SHORT_SIDE,
  readImageInfo,
  tierForShortSide,
  UnreadableImage,
} from './dimensions.js';

function png(width: number, height: number): Uint8Array {
  return maskPng({ width, height, colour: [10, 20, 30], blobs: [] });
}

/** A minimal but valid JPEG: SOI, an APP0 segment, then a SOF0 frame header. */
function jpeg(width: number, height: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03,
    1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

test('reads PNG dimensions', () => {
  const info = readImageInfo(png(720, 960));
  assert.equal(info.format, 'png');
  assert.equal(info.width, 720);
  assert.equal(info.height, 960);
  assert.equal(info.shortSidePx, 720);
  assert.equal(info.contentType, 'image/png');
});

test('reads JPEG dimensions, width and height not transposed', () => {
  // The JPEG frame header stores height before width. Getting that backwards
  // would silently swap portrait for landscape.
  const info = readImageInfo(jpeg(1080, 1440));
  assert.equal(info.format, 'jpeg');
  assert.equal(info.width, 1080);
  assert.equal(info.height, 1440);
  assert.equal(info.shortSidePx, 1080);
});

test('the short side is the smaller dimension whichever way up', () => {
  assert.equal(readImageInfo(jpeg(1440, 1080)).shortSidePx, 1080);
  assert.equal(readImageInfo(jpeg(1080, 1440)).shortSidePx, 1080);
});

test('tier boundaries are exact', () => {
  assert.equal(tierForShortSide(MIN_SHORT_SIDE.hd), 'hd');
  assert.equal(tierForShortSide(MIN_SHORT_SIDE.hd - 1), 'sd');
  assert.equal(tierForShortSide(MIN_SHORT_SIDE.sd), 'sd');
  assert.equal(tierForShortSide(MIN_SHORT_SIDE.sd - 1), null);
});

test('a 720p capture cannot reach HD', () => {
  // Worth pinning: the camera preset most likely to be requested is 720p, and
  // 720 is the short side, so it is SD no matter how good the lighting is.
  assert.equal(tierForShortSide(720), 'sd');
});

test('mislabelled content types are caught by the bytes', () => {
  // A PNG announced as image/jpeg still reads as a PNG.
  assert.equal(readImageInfo(png(600, 600)).contentType, 'image/png');
});

test('unsupported and truncated files are rejected', () => {
  assert.throws(() => readImageInfo(new Uint8Array(8)), UnreadableImage);
  assert.throws(
    () => readImageInfo(new Uint8Array([0x47, 0x49, 0x46, 0x38, ...new Array(40).fill(0)])),
    UnreadableImage,
  );
  assert.throws(() => readImageInfo(new Uint8Array([0xff, 0xd8, ...new Array(40).fill(0)])), UnreadableImage);
});

test('absurd dimensions are rejected', () => {
  assert.throws(() => readImageInfo(jpeg(4, 4)), UnreadableImage);
});
