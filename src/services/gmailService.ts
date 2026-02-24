const CLIENT_ID = "651220395570-pqrrujhhn8cucoleskno3opo7h9e43sa.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest";

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
          await gapi.client.init({
            discoveryDocs: [DISCOVERY_DOC],
          });
          
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

export const getNewsEmails = (): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      return reject(new Error("구글 인증 시스템이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요."));
    }

    const gapi = (window as any).gapi;

    tokenClient.callback = async (resp: any) => {
      if (resp.error !== undefined) {
        return reject(new Error("구글 로그인이 취소되었거나 실패했습니다."));
      }

      try {
        // ⭐️ [수정됨] 띄어쓰기를 무시하고 '뉴스요약' 라벨을 무조건 찾아냅니다!
        const labelsRes = await gapi.client.gmail.users.labels.list({ userId: 'me' });
        const newsLabel = labelsRes.result.labels.find((l: any) => 
          l.name && l.name.replace(/\s+/g, '').includes('뉴스요약')
        );

        if (!newsLabel) throw new Error("'뉴스요약' 라벨을 찾을 수 없습니다. G메일에 '뉴스요약' 라벨을 먼저 만들어주세요.");

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

          try {
            let base64 = body.replace(/-/g, '+').replace(/_/g, '/');
            while (base64.length % 4) { base64 += '='; }
            return decodeURIComponent(escape(atob(base64)));
          } catch (e) {
            return "본문 디코딩 실패";
          }
        }));

        resolve(emailContents.join('\n\n---\n\n'));
      } catch (err: any) {
        reject(new Error(err.message || "메일을 가져오는 중 알 수 없는 오류가 발생했습니다."));
      }
    };

    if (gapi.client.getToken() === null) {
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
      tokenClient.requestAccessToken({ prompt: '' });
    }
  });
};