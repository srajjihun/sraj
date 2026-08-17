// 최소 ZIP 리더.
//
// HWPX 와 DOCX 는 속이 ZIP 입니다. 이 프로젝트는 외부 패키지를 쓰지 않으므로
// (npm install 없이 PC 에서 바로 돌아야 합니다) 필요한 만큼만 직접 읽습니다.
//
// 읽는 것: 중앙 디렉터리(End of Central Directory → Central Directory)
// 푸는 것: 저장(0) · Deflate(8) 두 가지. HWPX 는 이 둘만 씁니다.
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** 뒤에서부터 EOCD(끝 표식)를 찾습니다. 주석이 붙어 있을 수 있어 최대 64KB 훑습니다. */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 0x10000 - 22);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * ZIP 안의 항목 목록을 돌려줍니다.
 * @returns {Array<{name:string, read:()=>Buffer}>}
 */
export function readZip(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("ZIP 형식이 아닙니다 (끝 표식을 찾지 못했습니다)");

  let count = buf.readUInt16LE(eocd + 10);
  let cenOffset = buf.readUInt32LE(eocd + 16);

  // 항목이 많거나 4GB 이상이면 ZIP64 로 오고, 위 값이 0xFFFF/0xFFFFFFFF 로 채워집니다.
  if (count === 0xffff || cenOffset === 0xffffffff) {
    for (let i = eocd - 20; i >= 0; i -= 1) {
      if (buf.readUInt32LE(i) === EOCD64_LOCATOR_SIG) {
        const z64 = Number(buf.readBigUInt64LE(i + 8));
        if (buf.readUInt32LE(z64) === EOCD64_SIG) {
          count = Number(buf.readBigUInt64LE(z64 + 32));
          cenOffset = Number(buf.readBigUInt64LE(z64 + 48));
        }
        break;
      }
    }
  }

  const entries = [];
  let p = cenOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    // 비트 11 이 켜져 있으면 파일명이 UTF-8 입니다. 안 켜져 있으면 CP437 인데,
    // 한글 파일명은 실제로는 CP949 로 들어오는 경우가 많아 그대로 latin1 로 읽고
    // 필요할 때만 해석합니다. (HWPX 내부 이름은 전부 ASCII 라 문제되지 않습니다)
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    entries.push({
      name,
      read() {
        if (buf.readUInt32LE(localOffset) !== LOC_SIG) throw new Error(`ZIP 항목이 손상됐습니다: ${name}`);
        const lnameLen = buf.readUInt16LE(localOffset + 26);
        const lextraLen = buf.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + lnameLen + lextraLen;
        const raw = buf.subarray(start, start + compSize);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) return inflateRawSync(raw);
        throw new Error(`지원하지 않는 압축 방식(${method})입니다: ${name}`);
      },
    });
  }
  return entries;
}

/** 이름이 정확히 일치하는 항목의 내용을 UTF-8 문자열로 돌려줍니다. */
export function readZipText(buf, name) {
  const e = readZip(buf).find((x) => x.name === name);
  return e ? e.read().toString("utf8") : null;
}
