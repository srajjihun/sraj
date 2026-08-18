// 복합 문서(Compound File Binary, 흔히 OLE2) 읽기.
//
// 왜 직접 만드는가:
//   구형 HWP(.hwp)는 이 형식의 껍데기 안에 내용이 들어 있습니다. 지금까지는
//   한글(한컴오피스)에게 HWPX 로 바꿔 달라고 시켰는데, 그러려면 한글의 보안
//   팝업을 없애는 FilePathCheckerModuleExample.dll 이 필요합니다. 그런데 그
//   파일은 한글 설치본에 들어 있지 않은 경우가 많고, 실제로 이 PC 에서도
//   찾지 못했습니다. 한글에 기대는 한 이 문제는 PC 마다 되풀이됩니다.
//   그래서 껍데기를 우리가 직접 엽니다. 그러면 한글이 없어도, Windows 가
//   아니어도(GitHub 쪽에서도) HWP 를 읽을 수 있습니다.
//
//   외부 라이브러리는 쓰지 않습니다. 이 저장소는 설치 과정 없이 Node 만으로
//   돌아가야 하기 때문입니다.
//
// 형식 요약:
//   파일이 일정한 크기의 "구역(sector)"으로 잘려 있고, 각 스트림은 구역들이
//   사슬처럼 이어진 형태입니다. 어느 구역 다음에 어느 구역이 오는지는 FAT
//   이라는 표에 적혀 있습니다. 4096 바이트보다 작은 스트림은 낭비를 줄이려고
//   "미니 구역"(64 바이트)에 따로 모아 두고, 그 사슬은 미니 FAT 에 있습니다.

const SIG = "d0cf11e0a1b11ae1";
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

/** 사슬을 끝까지 따라가며 구역 번호를 모읍니다. 고장난 파일에서 무한루프에 빠지지 않게 막습니다. */
function chain(fat, start, limit) {
  const out = [];
  let s = start;
  const seen = new Set();
  while (s !== ENDOFCHAIN && s !== FREESECT && s < fat.length) {
    if (seen.has(s)) break; // 사슬이 자기 자신으로 돌아오는 깨진 파일
    seen.add(s);
    out.push(s);
    if (out.length > limit) break;
    s = fat[s];
  }
  return out;
}

/**
 * @param {Buffer} buf
 * @returns {{ read(path:string): Buffer|null, has(path:string): boolean, names(): string[] }}
 */
export function openCfb(buf) {
  if (buf.length < 512) throw new Error("파일이 너무 짧습니다");
  if (buf.toString("hex", 0, 8) !== SIG) throw new Error("복합 문서가 아닙니다");

  const sectorShift = buf.readUInt16LE(30);
  const miniShift = buf.readUInt16LE(32);
  const sectorSize = 1 << sectorShift;
  const miniSize = 1 << miniShift;
  if (sectorSize < 128 || sectorSize > 1 << 20) throw new Error(`구역 크기가 이상합니다(${sectorSize})`);

  const dirStart = buf.readUInt32LE(48);
  const miniCutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readUInt32LE(60);
  const difatStart = buf.readUInt32LE(68);
  const difatCount = buf.readUInt32LE(72);

  const sectorCount = Math.max(0, Math.floor((buf.length - 512) / sectorSize));
  // 구역 N 의 시작 위치. 머리말 512 바이트 뒤부터 셉니다.
  const at = (n) => 512 + n * sectorSize;
  const sector = (n) => {
    const off = at(n);
    if (n < 0 || off + sectorSize > buf.length) return null;
    return buf.subarray(off, off + sectorSize);
  };

  // ── FAT 이 들어 있는 구역 목록(DIFAT) 모으기 ──
  const fatSectors = [];
  for (let i = 0; i < 109; i += 1) {
    const v = buf.readUInt32LE(76 + i * 4);
    if (v === FREESECT || v === ENDOFCHAIN) break;
    fatSectors.push(v);
  }
  // 109 개로 모자라면 DIFAT 이 별도 구역으로 이어집니다.
  let d = difatStart;
  for (let i = 0; i < difatCount && d !== ENDOFCHAIN && d !== FREESECT; i += 1) {
    const s = sector(d);
    if (!s) break;
    const perSector = sectorSize / 4 - 1;
    for (let j = 0; j < perSector; j += 1) {
      const v = s.readUInt32LE(j * 4);
      if (v === FREESECT || v === ENDOFCHAIN) break;
      fatSectors.push(v);
    }
    d = s.readUInt32LE(sectorSize - 4);
  }

  // ── FAT 펼치기 ──
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4));
  let k = 0;
  for (const fs of fatSectors) {
    const s = sector(fs);
    if (!s) { k += sectorSize / 4; continue; }
    for (let j = 0; j < sectorSize / 4; j += 1) fat[k++] = s.readUInt32LE(j * 4);
  }

  const readChain = (start, byteLen) => {
    const need = Math.ceil(byteLen / sectorSize);
    const list = chain(fat, start, Math.max(need + 8, sectorCount + 8));
    const parts = [];
    for (const n of list) {
      const s = sector(n);
      parts.push(s ?? Buffer.alloc(sectorSize));
    }
    return Buffer.concat(parts).subarray(0, byteLen);
  };

  // ── 디렉터리(파일 목록) 읽기 ──
  const dirBytes = readChain(dirStart, sectorCount * sectorSize);
  const entries = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const e = dirBytes.subarray(off, off + 128);
    const nameLen = e.readUInt16LE(64);
    const type = e[66];
    if (type === 0) { entries.push(null); continue; }
    // 이름은 UTF-16LE 이고 길이에 끝의 널 문자가 포함돼 있습니다.
    const name = nameLen > 2 ? e.toString("utf16le", 0, Math.min(nameLen - 2, 64)) : "";
    entries.push({
      name,
      type, // 1 폴더 / 2 파일 / 5 최상위
      left: e.readUInt32LE(68),
      right: e.readUInt32LE(72),
      child: e.readUInt32LE(76),
      start: e.readUInt32LE(116),
      size: Number(e.readBigUInt64LE(120) & 0xffffffffn),
    });
  }
  if (!entries.length || !entries[0]) throw new Error("디렉터리를 읽지 못했습니다");

  // 항목들은 좌/우/자식으로 이어진 나무 구조입니다. 경로 이름으로 펼쳐 둡니다.
  const paths = new Map();
  const visited = new Set();
  const walk = (idx, prefix) => {
    if (idx === FREESECT || idx >= entries.length || visited.has(idx)) return;
    visited.add(idx);
    const e = entries[idx];
    if (!e) return;
    walk(e.left, prefix);
    const path = prefix + e.name;
    paths.set(path, e);
    if (e.type === 1) walk(e.child, `${path}/`);
    walk(e.right, prefix);
  };
  walk(entries[0].child, "");

  // ── 미니 스트림 ──
  // 작은 파일들은 최상위 항목이 가리키는 한 덩어리 안에 64 바이트 단위로 모여 있습니다.
  let miniFat = null;
  let miniStream = null;
  const ensureMini = () => {
    if (miniFat) return;
    const mfSectors = chain(fat, miniFatStart, sectorCount + 8);
    const mf = new Uint32Array(mfSectors.length * (sectorSize / 4));
    let i = 0;
    for (const n of mfSectors) {
      const s = sector(n);
      if (!s) { i += sectorSize / 4; continue; }
      for (let j = 0; j < sectorSize / 4; j += 1) mf[i++] = s.readUInt32LE(j * 4);
    }
    miniFat = mf;
    const root = entries[0];
    miniStream = readChain(root.start, root.size);
  };

  const readEntry = (e) => {
    if (!e || e.type !== 2) return null;
    if (e.size === 0) return Buffer.alloc(0);
    if (e.size >= miniCutoff) return readChain(e.start, e.size);
    ensureMini();
    const list = chain(miniFat, e.start, Math.ceil(e.size / miniSize) + 8);
    const parts = list.map((n) => {
      const off = n * miniSize;
      return off + miniSize <= miniStream.length
        ? miniStream.subarray(off, off + miniSize)
        : Buffer.alloc(miniSize);
    });
    return Buffer.concat(parts).subarray(0, e.size);
  };

  return {
    names: () => [...paths.keys()],
    has: (p) => paths.has(p),
    read: (p) => readEntry(paths.get(p)),
  };
}
