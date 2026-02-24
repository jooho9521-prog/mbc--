const CLIENT_ID = "651220395570-pqrrujhhn8cucoleskno3opo7h9e43sa.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest";

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

// ⭐️ [완벽 해결] 구글 알림 메일 본문의 HTML을 분석하여 "진짜 개별 기사 링크"들을 싹쓸이합니다!
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

        const emailData: GmailNewsItem[] = [];

        await Promise.all(messages.map(async (msg: any) => {
          const details = await gapi.client.gmail.users.messages.get({ userId: 'me', id: msg.id });
          const payload = details.result.payload;
          
          let htmlBody = "";
          let textBody = "";

          const getBody = (parts: any[]) => {
            parts.forEach((p: any) => {
              if (p.mimeType === 'text/html' && p.body?.data) htmlBody = p.body.data;
              if (p.mimeType === 'text/plain' && p.body?.data) textBody = p.body.data;
              if (p.parts) getBody(p.parts);
            });
          };

          if (payload.parts) getBody(payload.parts);
          else {
            if (payload.mimeType === 'text/html') htmlBody = payload.body?.data || "";
            else textBody = payload.body?.data || "";
          }

          const decode = (data: string) => {
            if (!data) return "";
            try {
              let base64 = data.replace(/-/g, '+').replace(/_/g, '/');
              while (base64.length % 4) { base64 += '='; }
              return decodeURIComponent(escape(atob(base64)));
            } catch (e) { return ""; }
          };

          const decodedHtml = decode(htmlBody);
          const decodedText = decode(textBody);

          let foundLinks = false;

          // HTML 메일일 경우 브라우저 기능을 이용해 안쪽에 숨겨진 진짜 뉴스 링크를 모두 추출합니다!
          if (decodedHtml) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(decodedHtml, 'text/html');
            const links = doc.querySelectorAll('a');
            
            links.forEach(a => {
                let url = a.href || "";
                let rawTitle = a.textContent || "";
                rawTitle = rawTitle.replace(/\s+/g, ' ').trim();
                
                // 구글 알리미의 우회 링크를 진짜 기사 링크로 복원
                if (url.includes('google.com/url?q=')) {
                    try { url = decodeURIComponent(url.split('url?q=')[1].split('&')[0]); } catch(e){}
                } else if (url.includes('google.com/url?')) {
                    try { 
                      const urlParam = new URL(url).searchParams.get('url');
                      if (urlParam) url = urlParam;
                    } catch(e){}
                }
                
                // 수신거부 링크 등 잡다한 링크 필터링 & 기사 제목 길이 검증
                if (rawTitle.length > 8 && url.startsWith('http') && !url.includes('google.com/alerts') && !url.includes('unsubscribe') && !url.includes('preferences') && !url.includes('accounts.google')) {
                    let sourceName = "웹 뉴스";
                    try { sourceName = new URL(url).hostname.replace('www.', ''); } catch(e){}
                    
                    emailData.push({
                        title: rawTitle,
                        link: url,
                        source: sourceName,
                        body: decodedText.substring(0, 500) // AI에게 넘겨줄 분석용 본문 문맥
                    });
                    foundLinks = true;
                }
            });
          }

          // HTML 파싱 실패나 일반 텍스트 메일인 경우 에러 방지용으로 전체 메일 삽입
          if (!foundLinks && decodedText.length > 10) {
             const headers = payload.headers || [];
             const subject = headers.find((h: any) => h.name === 'Subject')?.value || "제목 없음";
             emailData.push({
                title: subject,
                link: `https://mail.google.com/mail/u/0/#message/${msg.id}`,
                source: "Gmail 원문",
                body: decodedText.substring(0, 500)
             });
          }
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