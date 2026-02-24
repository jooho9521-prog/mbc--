const CLIENT_ID = "651220395570-pqrrujhhn8cucoleskno3opo7h9e43sa.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/gmail.readonly";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest";

// ⭐️ 메일 안의 '진짜 기사'를 담을 규격
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

// ⭐️ [핵심] 구글 알림 메일 본문을 파싱하여 '실제 기사 링크'를 찾아냅니다.
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

          // 메일 본문 깊숙한 곳에서 HTML과 Text 분리 추출
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

          // Base64 디코딩 안전 함수
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

          // ⭐️ 구글 알림(HTML) 속에서 진짜 뉴스 링크와 제목만 추출하는 정규식
          const linkRegex = /<a\s+(?:[^>]*?\s+)?href=["'](https?:\/\/[^"']+)["'][^>]*>(.*?)<\/a>/gi;
          let match;
          let foundLinks = false;

          while ((match = linkRegex.exec(decodedHtml)) !== null) {
            let url = match[1];
            // HTML 태그 제거하고 순수 제목만 추출
            let rawTitle = match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

            // 구글 알리미 우회 링크인 경우 원래 기사 링크로 복원
            if (url.includes('google.com/url?q=')) {
              try { url = decodeURIComponent(url.split('url?q=')[1].split('&')[0]); } catch(e){}
            }

            // 쓸데없는 수신거부 링크 등은 필터링하고 진짜 기사만 배열에 담기
            if (rawTitle.length > 10 && !url.includes('unsubscribe') && !url.includes('preferences') && !url.includes('accounts.google') && !url.includes('pubsub')) {
              let sourceName = "웹 뉴스";
              try { sourceName = new URL(url).hostname.replace('www.', ''); } catch(e){}

              emailData.push({
                title: rawTitle,
                link: url,
                source: sourceName,
                body: decodedText.substring(0, 300) // 요약용 텍스트
              });
              foundLinks = true;
            }
          }

          // 구글 알림이 아닌 일반 텍스트 메일일 경우를 위한 예외 처리
          if (!foundLinks && decodedText.length > 10) {
             emailData.push({
                title: "일반 이메일",
                link: `https://mail.google.com/mail/u/0/#message/${msg.id}`,
                source: "Gmail",
                body: decodedText.substring(0, 300)
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