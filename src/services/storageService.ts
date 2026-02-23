
const STORAGE_KEY = 'trendpulse_history';

export interface SavedReport {
  id: string;
  date: string;
  keyword: string;
  summary: string;
  expanded: string;
}

export const storageService = {
  // 저장하기
  save: (report: Omit<SavedReport, 'id' | 'date'>): SavedReport => {
    const history = storageService.getAll();
    const newReport: SavedReport = {
      ...report,
      id: Date.now().toString(),
      date: new Date().toLocaleString('ko-KR')
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify([newReport, ...history]));
    return newReport;
  },

  // 모두 가져오기
  getAll: (): SavedReport[] => {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  },

  // 삭제하기
  delete: (id: string): SavedReport[] => {
    const history = storageService.getAll();
    const filtered = history.filter(item => item.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return filtered;
  }
};
