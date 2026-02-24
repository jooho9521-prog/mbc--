const CLIENT_ID = "651220395570-pqrrujhhn8cucoleskno3opo7h9e43sa.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest";

// ⭐️ [추가] 메일 데이터를 분리해서 담을 규격 생성
export interface GmailNewsItem {
  title: string;
  body: string;
  link: string;
  source: string;
}

let tokenClient: any;

export const initGoogleAuth = () => {
  return new Promise((resolve) => {
    const loadGapi = new Promise((res) => {
      if ((window as any).gapi) return res(true);
      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => res(true);
      document.body.appendChild(script);
    });

    const loadGis = new Promise((res) => {
      if ((window as any).google?.accounts?.oauth2) return res(true);
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => res(true);
      document.body.appendChild(script);
    });

    Promise.all([loadGapi, loadGis]).then(() => {
      const gapi = (window as any).gapi;
      const google = (window as any).google;

      gapi.load('client', async () => {
        try {
          await gapi.client.init({ discoveryDocs: [DISCOVERY_DOC] });
          tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '', 
          });
          resolve(true);
        } catch (err) {
          console.error("Google API Init Error:", err);
          resolve(false);
        }
      });
    });
  });
};

// ⭐️ [수정됨] 제목, 보낸사람, 본문, 링크를 각각 분리해서 반환하도록 업그레이드
export const getNewsEmails = (): Promise<GmailNewsItem[]> => {
  return new Promise((resolve, reject) => {
    if (!tokenClient) return reject(new Error("구글 인증 시스템이 아직 준비되지 않았습니다."));
    const gapi = (window as any).gapi;

    tokenClient.callback = async (resp: any) => {
      if (resp.error !== undefined) return reject(new Error("구글 로그인이 취소되었거나 실패했습니다."));

      try {
        const labelsRes = await gapi.client.gmail.users.labels.list({ userId: 'me' });
        const newsLabel = labelsRes.result.labels.find((l: any) => 
          l.name && l.name.replace(/\s+/g, '').includes('뉴스요약')
        );

        if (!newsLabel) throw new Error("'뉴스요약' 라벨을 찾을 수 없습니다.");

        const messagesRes = await gapi.client.gmail.users.messages.list({
          userId: 'me',
          labelIds: [newsLabel.id],
          maxResults: 5
        });

        const messages = messagesRes.result.messages || [];
        if (messages.length === 0) throw new Error("'뉴스요약' 라벨에 메일이 없습니다.");

        const emailData = await Promise.all(messages.map(async (msg: any) => {
          const details = await gapi.client.gmail.users.messages.get({ userId: 'me', id: msg.id });
          const payload = details.result.payload;
          const headers = payload.headers || [];

          // 헤더에서 제목(Subject)과 보낸사람(From) 추출
          const subjectHeader = headers.find((h: any) => h.name === 'Subject');
          const fromHeader = headers.find((h: any) => h.name === 'From');

          const title = subjectHeader ? subjectHeader.value : "제목 없음";
          let sourceName = "Gmail 알림";
          if (fromHeader) {
            sourceName = fromHeader.value.split('<')[0].replace(/"/g, '').trim() || fromHeader.value;
          }

          let body = "";
          if (payload.parts) {
            const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain') || payload.parts[0];
            body = textPart.body?.data || "";
          } else {
            body = payload.body?.data || "";
          }

          let decodedBody = "";
          try {
            let base64 = body.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) { base64 += '='; }
            decodedBody = decodeURIComponent(escape(atob(base64)));
          } catch (e) {
            decodedBody = "본문 디코딩 실패";
          }

          return {
            title: title,
            body: decodedBody,
            link: `https://mail.google.com/mail/u/0/#message/${msg.id}`,
            source: sourceName
          };
        }));

        resolve(emailData);
      } catch (err: any) {
        reject(new Error(err.message || "오류가 발생했습니다."));
      }
    };

    if (gapi.client.getToken() === null) {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      tokenClient.requestAccessToken({ prompt: '' });
    }
  });
};