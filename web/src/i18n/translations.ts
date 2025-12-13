export type Language = 'en' | 'ru';

export interface Translations {
  // Pre-join view
  videoConference: string;
  startOrJoinCall: string;
  roomId: string;
  roomIdPlaceholder: string;
  password: string;
  passwordPlaceholder: string;
  advancedSettings: string;
  videoQuality: string;
  roomPassword: string;
  roomPasswordPlaceholder: string;
  passwordHint: string;
  passwordHintPlaceholder: string;
  joinRoom: string;
  createNewRoom: string;
  room: string;
  status: string;
  active: string;
  willBeCreated: string;
  quality: string;
  switchToClassicView: string;
  
  // In-room view
  participants: string;
  participant: string;
  copyLink: string;
  copied: string;
  leave: string;
  you: string;
  
  // Controls
  mute: string;
  unmute: string;
  disableVideo: string;
  enableVideo: string;
  switchCamera: string;
  shareScreen: string;
  stopSharing: string;
  fullscreen: string;
  exitFullscreen: string;
  
  // Settings
  settings: string;
  turnConfiguration: string;
  turnUrls: string;
  turnUsername: string;
  turnPassword: string;
  roomActions: string;
  closeRoomForEveryone: string;
  closeSettings: string;
  language: string;
  
  // Messages
  noRemoteParticipants: string;
  
  // Alerts & Errors
  enterRoomId: string;
  passwordRequired: string;
  createRoomFailed: string;
  closeRoomConfirm: string;
  failedToCloseRoom: string;
  roomClosedForEveryone: string;
  closeRoomRequestFailed: string;
}

export const translations: Record<Language, Translations> = {
  ru: {
    // Pre-join view
    videoConference: 'Видеоконференция',
    startOrJoinCall: 'Начать или присоединиться к видеозвонку',
    roomId: 'ID комнаты',
    roomIdPlaceholder: 'Введите ID комнаты или оставьте пустым для создания',
    password: 'Пароль',
    passwordPlaceholder: 'Введите пароль',
    advancedSettings: 'Дополнительные настройки',
    videoQuality: 'Качество видео',
    roomPassword: 'Пароль комнаты (необязательно)',
    roomPasswordPlaceholder: 'Установить пароль для новой комнаты',
    passwordHint: 'Подсказка к паролю (необязательно)',
    passwordHintPlaceholder: 'Подсказка для пароля',
    joinRoom: 'Войти в комнату',
    createNewRoom: 'Создать новую комнату',
    room: 'Комната',
    status: 'Статус',
    active: 'Активна',
    willBeCreated: 'Будет создана',
    quality: 'Качество',
    switchToClassicView: 'Переключиться на классический вид',
    
    // In-room view
    participants: 'участников',
    participant: 'участник',
    copyLink: 'Копировать ссылку',
    copied: 'Скопировано!',
    leave: 'Выйти',
    you: 'Вы',
    
    // Messages
    noRemoteParticipants: 'Нет других участников',
    
    // Controls
    mute: 'Выключить микрофон',
    unmute: 'Включить микрофон',
    disableVideo: 'Выключить видео',
    enableVideo: 'Включить видео',
    switchCamera: 'Переключить камеру',
    shareScreen: 'Поделиться экраном',
    stopSharing: 'Остановить показ',
    fullscreen: 'Полный экран',
    exitFullscreen: 'Выйти из полноэкранного режима',
    
    // Settings
    settings: 'Настройки',
    turnConfiguration: 'Конфигурация TURN',
    turnUrls: 'turn:host:3478,turns:host:5349',
    turnUsername: 'Имя пользователя TURN',
    turnPassword: 'Пароль TURN',
    roomActions: 'Действия с комнатой',
    closeRoomForEveryone: 'Закрыть комнату для всех',
    closeSettings: 'Закрыть настройки',
    language: 'Язык',
    
    // Alerts & Errors
    enterRoomId: 'Введите ID комнаты',
    passwordRequired: 'Требуется пароль',
    createRoomFailed: 'Не удалось создать комнату',
    closeRoomConfirm: 'Вы уверены, что хотите закрыть комнату для всех?',
    failedToCloseRoom: 'Не удалось закрыть комнату',
    roomClosedForEveryone: 'Комната закрыта для всех',
    closeRoomRequestFailed: 'Не удалось отправить запрос на закрытие комнаты',
  },
  en: {
    // Pre-join view
    videoConference: 'Video Conference',
    startOrJoinCall: 'Start or join a secure video call',
    roomId: 'Room ID',
    roomIdPlaceholder: 'Enter room ID or leave blank to create',
    password: 'Password',
    passwordPlaceholder: 'Enter password',
    advancedSettings: 'Advanced Settings',
    videoQuality: 'Video Quality',
    roomPassword: 'Room Password (optional)',
    roomPasswordPlaceholder: 'Set password for new room',
    passwordHint: 'Password Hint (optional)',
    passwordHintPlaceholder: 'Hint for password',
    joinRoom: 'Join Room',
    createNewRoom: 'Create New Room',
    room: 'Room',
    status: 'Status',
    active: 'Active',
    willBeCreated: 'Will be created',
    quality: 'Quality',
    switchToClassicView: 'Switch to Classic View',
    
    // In-room view
    participants: 'participants',
    participant: 'participant',
    copyLink: 'Copy Link',
    copied: 'Copied!',
    leave: 'Leave',
    you: 'You',
    
    // Messages
    noRemoteParticipants: 'No remote participants',
    
    // Controls
    mute: 'Mute',
    unmute: 'Unmute',
    disableVideo: 'Disable Video',
    enableVideo: 'Enable Video',
    switchCamera: 'Switch camera',
    shareScreen: 'Share screen',
    stopSharing: 'Stop sharing',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit Fullscreen',
    
    // Settings
    settings: 'Settings',
    turnConfiguration: 'TURN Configuration',
    turnUrls: 'turn:host:3478,turns:host:5349',
    turnUsername: 'TURN username',
    turnPassword: 'TURN password',
    roomActions: 'Room Actions',
    closeRoomForEveryone: 'Close Room For Everyone',
    closeSettings: 'Close Settings',
    language: 'Language',
    
    // Alerts & Errors
    enterRoomId: 'Enter room id',
    passwordRequired: 'Password required',
    createRoomFailed: 'Create room failed',
    closeRoomConfirm: 'Are you sure you want to close the room for everyone?',
    failedToCloseRoom: 'Failed to close room',
    roomClosedForEveryone: 'Room closed for everyone',
    closeRoomRequestFailed: 'Close room request failed',
  },
};