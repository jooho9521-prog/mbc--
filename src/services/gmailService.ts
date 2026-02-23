const CLIENT_ID = "651220395570-pqrrujhhn8cucoleskno3opo7h9e43sa.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";

// 구글 API 초기화 (수정됨: 스크립트 로딩 대기 로직 추가)
export const initGoogleAuth = () => {
  return new Promise((resolve) => {
    // 0.1초마다 구글 스크립트가 도착했는지 확인합니다.
    const checkGapiTimer = setInterval(() => {
      const gapi = (window as any).gapi;
      if (gapi) {
        clearInterval(checkGapiTimer); // 스크립트를 찾으면 확인 멈춤
        gapi.load('client:auth2', () => {
          gapi.client.init({
            clientId: CLIENT_ID,
            scope: SCOPES,
          }).then(() => resolve(true)).catch((err: any) => {
            console.error("Google Auth Init Error:", err);
            resolve(false);
          });
        });
      }
    }, 100);

    // 혹시라도 10초 동안 스크립트를 못 불러오면 에러 방지를 위해 종료
    setTimeout(() => {
      clearInterval(checkGapiTimer);
      if (!(window as any).gapi) resolve(false);
    }, 10000);
  });
};

// '뉴스요약' 라벨 메일 긁어오기 (수정됨: 안전한 디코딩 추가)
export const getNewsEmails = async () => {
  const gapi = (window as any).gapi;
  const authInstance = gapi.auth2.getAuthInstance();
  
  // 로그인 안 되어 있으면 로그인 창 띄우기
  if (!authInstance.isSignedIn.get()) {
    await authInstance.signIn();
  }

  // 1. '뉴스요약' 라벨 ID 찾기 
  const labelsRes = await gapi.client.gmail.users.labels.list({ userId: 'me' });
  const newsLabel = labelsRes.result.labels.find((l: any) => l.name === '뉴스요약');

  if (!newsLabel) throw new Error("'뉴스요약' 라벨을 찾을 수 없습니다. G메일에 '뉴스요약' 라벨을 먼저 만들어주세요.");

  // 2. 해당 라벨 메일 목록 (최근 5개)
  const messagesRes = await gapi.client.gmail.users.messages.list({
    userId: 'me',
    labelIds: [newsLabel.id],
    maxResults: 5
  });

  const messages = messagesRes.result.messages || [];
  if (messages.length === 0) throw new Error("'뉴스요약' 라벨에 메일이 없습니다.");

  const emailContents = await Promise.all(messages.map(async (msg: any) => {
    const details = await gapi.client.gmail.users.messages.get({ userId: 'me', id: msg.id });
    const payload = details.result.payload;
    let body = "";
    
    if (payload.parts) {
      const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain') || payload.parts[0];
      body = textPart.body?.data || "";
    } else {
      body = payload.body?.data || "";
    }

    // Base64 안전한 디코딩 (한글 깨짐 및 패딩 에러 방지)
    try {
      let base64 = body.replace(/-/g, '+').replace(/_/g, '/');
      while (base64.length % 4) { base64 += '='; }
      return decodeURIComponent(escape(atob(base64)));
    } catch (e) {
      return "본문 디코딩 실패";
    }
  }));

  return emailContents.join('\n\n---\n\n');
};