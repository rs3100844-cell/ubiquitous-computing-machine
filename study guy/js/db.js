/**
 * Study hub - IndexedDB Storage Manager
 * Handles local persistence of classes, subjects, chapters, and file blobs (Notes, Images, E-books)
 * Includes JSON export and import with Base64 encoding.
 */

class StudyHubDB {
  constructor() {
    this.dbName = 'StudyHubDB';
    this.dbVersion = 1;
    this.db = null;
  }

  // Initialize and open the IndexedDB database
  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Subjects store
        if (!db.objectStoreNames.contains('subjects')) {
          const subjectsStore = db.createObjectStore('subjects', { keyPath: 'id' });
          subjectsStore.createIndex('classNum', 'classNum', { unique: false });
        }

        // Chapters store
        if (!db.objectStoreNames.contains('chapters')) {
          const chaptersStore = db.createObjectStore('chapters', { keyPath: 'id' });
          chaptersStore.createIndex('subjectId', 'subjectId', { unique: false });
          chaptersStore.createIndex('classNum', 'classNum', { unique: false });
        }

        // Files store (Notes, Image Notes, E-books)
        if (!db.objectStoreNames.contains('files')) {
          const filesStore = db.createObjectStore('files', { keyPath: 'id' });
          filesStore.createIndex('chapterId', 'chapterId', { unique: false });
          filesStore.createIndex('subjectId', 'subjectId', { unique: false });
          filesStore.createIndex('classNum', 'classNum', { unique: false });
          filesStore.createIndex('section', 'section', { unique: false });
          filesStore.createIndex('lastOpened', 'lastOpened', { unique: false });
        }

        // Settings & Metadata store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        // Check if initial seeding is needed
        await this.checkInitialSeed();
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('IndexedDB open error:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  // Helper transaction wrapper
  async tx(storeName, mode, callback) {
    await this.init();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let request;

      try {
        request = callback(store);
      } catch (err) {
        return reject(err);
      }

      transaction.oncomplete = () => {
        resolve(request ? request.result : undefined);
      };

      transaction.onerror = (e) => {
        reject(e.target.error);
      };
    });
  }

  // --- SUBJECTS CRUD ---

  async getAllSubjects() {
    return this.tx('subjects', 'readonly', (store) => store.getAll());
  }

  async getSubjectsByClass(classNum) {
    const num = parseInt(classNum, 10);
    return this.tx('subjects', 'readonly', (store) => {
      const index = store.index('classNum');
      return index.getAll(num);
    });
  }

  async getSubject(id) {
    return this.tx('subjects', 'readonly', (store) => store.get(id));
  }

  async addSubject(subject) {
    const item = {
      id: subject.id || 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      classNum: parseInt(subject.classNum, 10),
      name: subject.name.trim(),
      icon: subject.icon || 'fa-book',
      color: subject.color || 'yellow',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.tx('subjects', 'readwrite', (store) => store.add(item));
    return item;
  }

  async updateSubject(id, updates) {
    const existing = await this.getSubject(id);
    if (!existing) throw new Error('Subject not found');
    const updated = {
      ...existing,
      ...updates,
      name: updates.name ? updates.name.trim() : existing.name,
      updatedAt: new Date().toISOString()
    };
    await this.tx('subjects', 'readwrite', (store) => store.put(updated));
    return updated;
  }

  async deleteSubject(id) {
    // Delete all chapters under this subject
    const chapters = await this.getChaptersBySubject(id);
    for (const chap of chapters) {
      await this.deleteChapter(chap.id);
    }
    // Delete the subject itself
    return this.tx('subjects', 'readwrite', (store) => store.delete(id));
  }

  // --- CHAPTERS CRUD ---

  async getAllChapters() {
    return this.tx('chapters', 'readonly', (store) => store.getAll());
  }

  async getChaptersBySubject(subjectId) {
    return this.tx('chapters', 'readonly', (store) => {
      const index = store.index('subjectId');
      return index.getAll(subjectId);
    });
  }

  async getChapter(id) {
    return this.tx('chapters', 'readonly', (store) => store.get(id));
  }

  async addChapter(chapter) {
    const item = {
      id: chapter.id || 'chap_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      subjectId: chapter.subjectId,
      classNum: parseInt(chapter.classNum, 10),
      chapterNum: chapter.chapterNum || 1,
      title: chapter.title.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.tx('chapters', 'readwrite', (store) => store.add(item));
    return item;
  }

  async updateChapter(id, updates) {
    const existing = await this.getChapter(id);
    if (!existing) throw new Error('Chapter not found');
    const updated = {
      ...existing,
      ...updates,
      title: updates.title ? updates.title.trim() : existing.title,
      updatedAt: new Date().toISOString()
    };
    await this.tx('chapters', 'readwrite', (store) => store.put(updated));
    return updated;
  }

  async deleteChapter(id) {
    // Delete all files in this chapter
    const files = await this.getFilesByChapter(id);
    for (const file of files) {
      await this.deleteFile(file.id);
    }
    return this.tx('chapters', 'readwrite', (store) => store.delete(id));
  }

  // --- FILES CRUD (Notes, Images, E-books) ---

  async getAllFiles() {
    return this.tx('files', 'readonly', (store) => store.getAll());
  }

  async getFilesByChapter(chapterId) {
    return this.tx('files', 'readonly', (store) => {
      const index = store.index('chapterId');
      return index.getAll(chapterId);
    });
  }

  async getFilesByChapterAndSection(chapterId, section) {
    const all = await this.getFilesByChapter(chapterId);
    return all.filter((f) => f.section === section);
  }

  async getFile(id) {
    return this.tx('files', 'readonly', (store) => store.get(id));
  }

  async addFile(fileData) {
    const item = {
      id: fileData.id || 'file_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      chapterId: fileData.chapterId,
      subjectId: fileData.subjectId,
      classNum: parseInt(fileData.classNum, 10),
      section: fileData.section, // 'notes' | 'images' | 'ebook'
      name: fileData.name.trim(),
      type: fileData.type || 'application/octet-stream',
      size: fileData.size || (fileData.blob ? fileData.blob.size : 0),
      blob: fileData.blob,
      createdAt: new Date().toISOString(),
      lastOpened: new Date().toISOString()
    };
    await this.tx('files', 'readwrite', (store) => store.add(item));
    return item;
  }

  async updateFileName(id, newName) {
    const existing = await this.getFile(id);
    if (!existing) throw new Error('File not found');
    existing.name = newName.trim();
    await this.tx('files', 'readwrite', (store) => store.put(existing));
    return existing;
  }

  async markFileOpened(id) {
    const existing = await this.getFile(id);
    if (existing) {
      existing.lastOpened = new Date().toISOString();
      await this.tx('files', 'readwrite', (store) => store.put(existing));
    }
    return existing;
  }

  async deleteFile(id) {
    return this.tx('files', 'readwrite', (store) => store.delete(id));
  }

  async getRecentFiles(limit = 8) {
    const all = await this.getAllFiles();
    return all
      .sort((a, b) => new Date(b.lastOpened || b.createdAt) - new Date(a.lastOpened || a.createdAt))
      .slice(0, limit);
  }

  // --- STATS ---

  async getGlobalStats() {
    const [subjects, chapters, files] = await Promise.all([
      this.getAllSubjects(),
      this.getAllChapters(),
      this.getAllFiles()
    ]);

    const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0);

    return {
      totalSubjects: subjects.length,
      totalChapters: chapters.length,
      totalFiles: files.length,
      totalBytes,
      notesCount: files.filter((f) => f.section === 'notes').length,
      imagesCount: files.filter((f) => f.section === 'images').length,
      ebooksCount: files.filter((f) => f.section === 'ebook').length
    };
  }

  async getClassStats(classNum) {
    const num = parseInt(classNum, 10);
    const subjects = await this.getSubjectsByClass(num);
    const subjectIds = new Set(subjects.map((s) => s.id));

    const allChapters = await this.getAllChapters();
    const classChapters = allChapters.filter((c) => subjectIds.has(c.subjectId));
    const chapterIds = new Set(classChapters.map((c) => c.id));

    const allFiles = await this.getAllFiles();
    const classFiles = allFiles.filter((f) => chapterIds.has(f.chapterId));

    return {
      subjectsCount: subjects.length,
      chaptersCount: classChapters.length,
      filesCount: classFiles.length
    };
  }

  // --- SEARCH ---

  async searchAll(query) {
    if (!query || !query.trim()) return { subjects: [], chapters: [], files: [] };
    const q = query.toLowerCase().trim();

    const [subjects, chapters, files] = await Promise.all([
      this.getAllSubjects(),
      this.getAllChapters(),
      this.getAllFiles()
    ]);

    const matchedSubjects = subjects.filter((s) => s.name.toLowerCase().includes(q));
    const matchedChapters = chapters.filter((c) => c.title.toLowerCase().includes(q) || ('chapter ' + c.chapterNum).includes(q));
    const matchedFiles = files.filter((f) => f.name.toLowerCase().includes(q));

    return {
      subjects: matchedSubjects,
      chapters: matchedChapters,
      files: matchedFiles
    };
  }

  // --- BACKUP & RESTORE ---

  // Export full backup with blobs converted to base64
  async exportBackup() {
    const [subjects, chapters, files] = await Promise.all([
      this.getAllSubjects(),
      this.getAllChapters(),
      this.getAllFiles()
    ]);

    const serializedFiles = [];
    for (const file of files) {
      let base64Data = null;
      if (file.blob) {
        base64Data = await this.blobToBase64(file.blob);
      }
      serializedFiles.push({
        id: file.id,
        chapterId: file.chapterId,
        subjectId: file.subjectId,
        classNum: file.classNum,
        section: file.section,
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: base64Data,
        createdAt: file.createdAt,
        lastOpened: file.lastOpened
      });
    }

    return {
      appName: 'StudyHub',
      version: 1,
      exportedAt: new Date().toISOString(),
      counts: {
        subjects: subjects.length,
        chapters: chapters.length,
        files: serializedFiles.length
      },
      subjects,
      chapters,
      files: serializedFiles
    };
  }

  // Import backup data and restore into IndexedDB
  async importBackup(backupData, overwrite = false) {
    if (!backupData || backupData.appName !== 'StudyHub') {
      throw new Error('Invalid backup file. Must be an official StudyHub export.');
    }

    if (overwrite) {
      // Clear current data
      await this.clearAllData();
    }

    // Insert subjects
    if (Array.isArray(backupData.subjects)) {
      for (const sub of backupData.subjects) {
        await this.tx('subjects', 'readwrite', (store) => store.put(sub));
      }
    }

    // Insert chapters
    if (Array.isArray(backupData.chapters)) {
      for (const chap of backupData.chapters) {
        await this.tx('chapters', 'readwrite', (store) => store.put(chap));
      }
    }

    // Insert files with restored blobs
    if (Array.isArray(backupData.files)) {
      for (const file of backupData.files) {
        let blob = null;
        if (file.dataUrl) {
          blob = await this.base64ToBlob(file.dataUrl, file.type);
        }
        const fileRecord = {
          id: file.id,
          chapterId: file.chapterId,
          subjectId: file.subjectId,
          classNum: file.classNum,
          section: file.section,
          name: file.name,
          type: file.type,
          size: file.size,
          blob: blob,
          createdAt: file.createdAt || new Date().toISOString(),
          lastOpened: file.lastOpened || new Date().toISOString()
        };
        await this.tx('files', 'readwrite', (store) => store.put(fileRecord));
      }
    }

    return {
      subjectsRestored: backupData.subjects?.length || 0,
      chaptersRestored: backupData.chapters?.length || 0,
      filesRestored: backupData.files?.length || 0
    };
  }

  async clearAllData() {
    await this.tx('subjects', 'readwrite', (store) => store.clear());
    await this.tx('chapters', 'readwrite', (store) => store.clear());
    await this.tx('files', 'readwrite', (store) => store.clear());
  }

  // --- BLOB UTILITIES ---

  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async base64ToBlob(dataUrl, defaultType = 'application/octet-stream') {
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  // --- DEFAULT SEEDING ---

  async checkInitialSeed() {
    const isSeeded = await this.tx('settings', 'readonly', (store) => store.get('is_seeded'));
    if (!isSeeded) {
      await this.seedStarterContent();
      await this.tx('settings', 'readwrite', (store) => store.put({ key: 'is_seeded', value: true, date: new Date().toISOString() }));
    }
  }

  async seedStarterContent() {
    // Populate starter subjects and chapters for key classes so new users have immediate rich structure
    const sampleSyllabus = [
      {
        classNum: 10,
        subjects: [
          {
            name: 'Mathematics',
            icon: 'fa-calculator',
            color: 'yellow',
            chapters: [
              { num: 1, title: 'Real Numbers' },
              { num: 2, title: 'Polynomials' },
              { num: 3, title: 'Pair of Linear Equations in Two Variables' },
              { num: 4, title: 'Quadratic Equations' },
              { num: 5, title: 'Arithmetic Progressions' },
              { num: 6, title: 'Triangles' }
            ]
          },
          {
            name: 'Science',
            icon: 'fa-flask-vial',
            color: 'yellow',
            chapters: [
              { num: 1, title: 'Chemical Reactions and Equations' },
              { num: 2, title: 'Acids, Bases and Salts' },
              { num: 3, title: 'Metals and Non-metals' },
              { num: 4, title: 'Life Processes' },
              { num: 5, title: 'Control and Coordination' }
            ]
          },
          {
            name: 'Social Science',
            icon: 'fa-earth-americas',
            color: 'yellow',
            chapters: [
              { num: 1, title: 'The Rise of Nationalism in Europe' },
              { num: 2, title: 'Resources and Development' },
              { num: 3, title: 'Power Sharing' },
              { num: 4, title: 'Development' }
            ]
          },
          {
            name: 'English Language & Lit',
            icon: 'fa-book-open',
            color: 'yellow',
            chapters: [
              { num: 1, title: 'A Letter to God' },
              { num: 2, title: 'Nelson Mandela: Long Walk to Freedom' },
              { num: 3, title: 'Two Stories about Flying' }
            ]
          }
        ]
      },
      {
        classNum: 9,
        subjects: [
          {
            name: 'Mathematics',
            icon: 'fa-calculator',
            color: 'yellow',
            chapters: [
              { num: 1, title: 'Number Systems' },
              { num: 2, title: 'Polynomials' },
              { num: 3, title: 'Coordinate Geometry' }
            ]
          },
          {
            name: 'Science',
            icon: 'fa-atom',
            color: 'yellow',
            chapters: [
              { num: 1, title: 'Matter in Our Surroundings' },
              { num: 2, title: 'Is Matter Around Us Pure' },
              { num: 3, title: 'The Fundamental Unit of Life' }
            ]
          }
        ]
      },
      {
        classNum: 11,
        subjects: [
          {
            name: 'Physics',
            icon: 'fa-magnet',
            color: 'yellow',
            chapters: [
              { num: 1, title: 'Units and Measurements' },
              { num: 2, title: 'Motion in a Straight Line' },
              { num: 3, title: 'Laws of Motion' }
            ]
          },
          {
            name: 'Chemistry',
            icon: 'fa-flask',
            color: 'yellow',
            chapters: [
              { num: 1, title: 'Some Basic Concepts of Chemistry' },
              { num: 2, title: 'Structure of Atom' }
            ]
          }
        ]
      },
      {
        classNum: 12,
        subjects: [
          {
            name: 'Physics',
            icon: 'fa-bolt',
            color: 'yellow',
            chapters: [
              { num: 1, title: 'Electric Charges and Fields' },
              { num: 2, title: 'Electrostatic Potential and Capacitance' }
            ]
          },
          {
            name: 'Mathematics',
            icon: 'fa-square-root-variable',
            color: 'yellow',
            chapters: [
              { num: 1, title: 'Relations and Functions' },
              { num: 2, title: 'Inverse Trigonometric Functions' }
            ]
          }
        ]
      }
    ];

    for (const cls of sampleSyllabus) {
      for (const subj of cls.subjects) {
        const subItem = await this.addSubject({
          classNum: cls.classNum,
          name: subj.name,
          icon: subj.icon,
          color: subj.color
        });

        for (const chap of subj.chapters) {
          await this.addChapter({
            subjectId: subItem.id,
            classNum: cls.classNum,
            chapterNum: chap.num,
            title: chap.title
          });
        }
      }
    }

    // Add a friendly sample note document in Class 10 -> Mathematics -> Real Numbers so the user can see immediate previews!
    try {
      const class10Subjects = await this.getSubjectsByClass(10);
      const mathSub = class10Subjects.find((s) => s.name === 'Mathematics');
      if (mathSub) {
        const chapters = await this.getChaptersBySubject(mathSub.id);
        const realNumbers = chapters.find((c) => c.title === 'Real Numbers');
        if (realNumbers) {
          // Create a minimal lightweight valid sample PDF Blob
          const samplePdfContent = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 170 >> stream
BT
/F1 24 Tf
100 700 Td
(Welcome to Study hub!) Tj
/F1 14 Tf
0 -40 Td
(Chapter 1: Real Numbers - Quick Revision Notes) Tj
0 -25 Td
(1. Euclid's Division Lemma: a = bq + r, 0 <= r < b) Tj
0 -25 Td
(2. Fundamental Theorem of Arithmetic) Tj
0 -25 Td
(3. Revisiting Irrational Numbers and Decimal Expansions) Tj
ET
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000465 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
538
%%EOF`;
          const pdfBlob = new Blob([samplePdfContent], { type: 'application/pdf' });
          await this.addFile({
            chapterId: realNumbers.id,
            subjectId: mathSub.id,
            classNum: 10,
            section: 'notes',
            name: 'Real_Numbers_Summary_Sheet.pdf',
            type: 'application/pdf',
            size: pdfBlob.size,
            blob: pdfBlob
          });

          // Sample SVG converted to PNG/Image Note for Real Numbers formula card
          const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
            <rect width="100%" height="100%" fill="#111418"/>
            <rect x="20" y="20" width="760" height="410" rx="16" fill="#1E232A" stroke="#FFE600" stroke-width="4"/>
            <text x="50" y="80" fill="#FFE600" font-family="sans-serif" font-size="28" font-weight="bold">Study hub · Formula Mindmap</text>
            <text x="50" y="125" fill="#FFFFFF" font-family="sans-serif" font-size="20">Chapter 1: Real Numbers</text>
            <rect x="50" y="150" width="700" height="2" fill="#333B47"/>
            <text x="50" y="195" fill="#E2E8F0" font-family="sans-serif" font-size="18">• HCF(a, b) × LCM(a, b) = a × b</text>
            <text x="50" y="240" fill="#E2E8F0" font-family="sans-serif" font-size="18">• Terminating decimal: Denominator factor in form 2^n × 5^m</text>
            <text x="50" y="285" fill="#E2E8F0" font-family="sans-serif" font-size="18">• Non-terminating repeating: Denominator has factors other than 2 or 5</text>
            <rect x="50" y="330" width="220" height="45" rx="8" fill="#FFE600"/>
            <text x="75" y="360" fill="#111418" font-family="sans-serif" font-size="16" font-weight="bold">Ready to Practice ✓</text>
          </svg>`;
          const imgBlob = new Blob([svgContent], { type: 'image/svg+xml' });
          await this.addFile({
            chapterId: realNumbers.id,
            subjectId: mathSub.id,
            classNum: 10,
            section: 'images',
            name: 'Real_Numbers_Mindmap.svg',
            type: 'image/svg+xml',
            size: imgBlob.size,
            blob: imgBlob
          });
        }
      }
    } catch (err) {
      console.warn('Initial file seed skip:', err);
    }
  }
}

// Global instance
window.studyHubDB = new StudyHubDB();
