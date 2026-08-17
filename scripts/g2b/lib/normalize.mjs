// 나라장터 API 원본 레코드를 화면·판정에 쓰는 형태로 정규화합니다.
//
// 입찰공고(BidPublicInfoService ...PPSSrch)는 113개 필드가 오지만
// 그중 필요한 것만 추립니다. 필드 의미는 조달청 OpenAPI 참고자료 기준입니다.

function text(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function num(v) {
  const s = text(v).replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "2026-08-25 11:00:00" -> { date:"2026-08-25", time:"11:00" }
function splitDt(v) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(text(v));
  return m ? { date: m[1], time: m[2] ?? "" } : { date: "", time: "" };
}

// 첨부파일: ntceSpecFileNm1~10 / ntceSpecDocUrl1~10 을 짝지어 모읍니다.
function collectBidFiles(raw) {
  const files = [];
  for (let i = 1; i <= 10; i += 1) {
    const name = text(raw[`ntceSpecFileNm${i}`]);
    const url = text(raw[`ntceSpecDocUrl${i}`]);
    if (name && url) files.push({ name, url });
  }
  return files;
}

// 공동수급 허용 여부.
// cmmnSpldmdMethdNm 에 "불허"가 들어가면 단독 수주만 가능하고,
// "공동이행"·"분담이행" 이면 컨소시엄 구성이 가능합니다.
// 값이 비어 있으면 공고문을 봐야 하므로 판정을 보류(null)합니다.
function jointAllowed(raw) {
  const m = text(raw.cmmnSpldmdMethdNm);
  if (m) {
    if (m.includes("불허")) return false;
    if (m.includes("이행") || m.includes("허용")) return true;
  }
  const y = text(raw.cmmnCntrctYn);
  if (y === "Y") return true;
  if (y === "N") return false;
  return null; // 미상
}

// 사전규격: 파일명 필드가 없어 URL만 옵니다.
function collectPrespecFiles(raw) {
  const files = [];
  for (let i = 1; i <= 5; i += 1) {
    const url = text(raw[`specDocFileUrl${i}`]);
    if (url) files.push({ name: `규격서 ${i}`, url });
  }
  return files;
}

/** 입찰공고 1건 정규화 */
export function normalizeBid(raw, kind = "용역") {
  const notice = splitDt(raw.bidNtceDt);
  const close = splitDt(raw.bidClseDt);
  const opening = splitDt(raw.opengDt);
  const qlfct = splitDt(raw.bidQlfctRgstDt);

  return {
    type: "bid",
    bidNo: `${text(raw.bidNtceNo)}-${text(raw.bidNtceOrd) || "000"}`,
    kind,
    title: text(raw.bidNtceNm),
    org: text(raw.dminsttNm) || text(raw.ntceInsttNm), // 수요기관 우선
    noticeOrg: text(raw.ntceInsttNm),
    date: notice.date,
    deadline: close.date,
    deadlineTime: close.time,
    opening: opening.date ? `${opening.date} ${opening.time}`.trim() : "",
    qlfctDate: qlfct.date, // 입찰참가자격 등록마감 — 놓치기 쉬운 앞선 마감
    qlfctTime: qlfct.time,

    price: num(raw.presmptPrce), // 추정가격 (부가세 제외)
    budget: num(raw.asignBdgtAmt), // 배정예산

    method: text(raw.cntrctCnclsMthdNm), // 일반경쟁/제한경쟁/수의계약
    winnerMethod: text(raw.sucsfbidMthdNm), // 협상에의한계약/적격심사제 …
    techRate: num(raw.techAbltEvlRt), // 기술능력평가 배점비율
    priceRate: num(raw.bidPrceEvlRt), // 입찰가격평가 배점비율

    reNtce: text(raw.reNtceYn) === "Y", // 재공고 = 1차 유찰 신호
    intlBid: text(raw.intrntnlBidYn) === "Y",
    arsltCmpt: text(raw.arsltCmptYn) === "Y", // 실적경쟁
    indstrytyLmt: text(raw.indstrytyLmtYn) === "Y", // 업종(면허)제한
    rgnLmt: text(raw.rgnLmtYn) === "Y", // 지역제한 (내용은 공고문에만 있음)

    // 공동수급(컨소시엄) — 지분 참여 시 지분율만큼 실적증명이 발급되므로
    // 단독 참여가 어려운 공고를 컨소시엄으로 갈 수 있는지가 여기서 갈린다.
    jointOk: jointAllowed(raw),
    jointMethod: text(raw.cmmnSpldmdMethdNm), // 공동이행 / 분담이행 / (없음)공동수급불허
    jointRgnLmt: text(raw.cmmnSpldmdCorpRgnLmtYn) === "Y", // 공동수급 구성원 지역제한

    categoryNo: text(raw.pubPrcrmntClsfcNo),
    category: text(raw.pubPrcrmntClsfcNm),
    categoryMid: text(raw.pubPrcrmntMidClsfcNm),
    categoryLarge: text(raw.pubPrcrmntLrgClsfcNm),

    files: collectBidFiles(raw),
    url: text(raw.bidNtceDtlUrl) || text(raw.bidNtceUrl),
  };
}

/** 사전규격 1건 정규화 */
export function normalizePrespec(raw) {
  const opinion = splitDt(raw.opninRgstClseDt);
  const rcpt = splitDt(raw.rcptDt);

  return {
    type: "pre",
    bidNo: text(raw.bfSpecRgstNo), // 사전규격등록번호를 키로 사용
    kind: text(raw.bsnsDivNm) || "용역",
    title: text(raw.prdctClsfcNoNm),
    org: text(raw.rlDminsttNm) || text(raw.orderInsttNm),
    noticeOrg: text(raw.orderInsttNm),
    date: rcpt.date,
    deadline: opinion.date, // 의견등록 마감
    deadlineTime: opinion.time,
    budget: num(raw.asignBdgtAmt),
    price: null,
    // 이 번호들이 채워지면 정식 공고로 전환된 것 — 화면에서는 숨깁니다.
    bidNtceNoList: text(raw.bidNtceNoList).split(",").map((s) => s.trim()).filter(Boolean),
    files: collectPrespecFiles(raw),
    url: "", // 사전규격은 개별 상세 URL 이 응답에 없음
  };
}
