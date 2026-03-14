export type Language = 'en' | 'ru';

export interface Translations {
  // Pre-join view
  videoConference: string;
  startOrJoinCall: string;
  username: string;
  usernamePlaceholder: string;
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
  
  // Connection status
  signalingReconnecting: string;
  signalingDisconnected: string;

  // Alerts & Errors
  enterRoomId: string;
  passwordRequired: string;
  createRoomFailed: string;
  closeRoomConfirm: string;
  failedToCloseRoom: string;
  roomClosedForEveryone: string;
  closeRoomRequestFailed: string;

  // Auth
  signIn: string;
  signInSubtitle: string;
  signInWithGoogle: string;
  signUpTitle: string;
  email: string;
  passwordLabel: string;
  displayNameLabel: string;
  noAccountSignUp: string;
  alreadyHaveAccount: string;
  joinAsGuest: string;
  signOutButton: string;
  signInToAccess: string;

  // App Shell / Tabs
  homeTab: string;
  chatsTab: string;
  contactsTab: string;
  location: string;
  currentLocation: string;
  locationHistory: string;
  openInMaps: string;
  noLocationData: string;
  contactAdded: string;
  deletedChat: string;
  contactAdded: string;
  roomsTab: string;
  optionsTab: string;

  // Home
  greeting: string;
  homeSubtitle: string;
  newChat: string;
  joinRoomAction: string;
  newGroupChat: string;
  callContact: string;

  // Chats
  chatsTitle: string;
  noConversations: string;
  startConversation: string;
  noMessages: string;
  loading: string;
  selectChat: string;

  // Rooms
  roomsTitle: string;
  selectRoom: string;
  recentRooms: string;
  noRecentRooms: string;
  deleteRoom: string;
  createRoom: string;

  // Options
  profile: string;

  // Chat conversation
  typeMessage: string;
  typing: string;
  members: string;
  confirmDelete: string;
  deleteConversation: string;
  confirmDeleteConversation: string;
  deletedChat: string;
  searchContacts: string;
  noContactsFound: string;
  groupNamePlaceholder: string;
  selectMembers: string;
  createGroup: string;
}

export const translations: Record<Language, Translations> = {
  ru: {
    // Pre-join view
    videoConference: 'Видеоконференция',
    startOrJoinCall: 'Начать или присоединиться к видеозвонку',
    username: 'Ваше имя',
    usernamePlaceholder: 'Введите ваше имя',
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
    
    // Connection status
    signalingReconnecting: 'Переподключение...',
    signalingDisconnected: 'Соединение потеряно',

    // Alerts & Errors
    enterRoomId: 'Введите ID комнаты',
    passwordRequired: 'Требуется пароль',
    createRoomFailed: 'Не удалось создать комнату',
    closeRoomConfirm: 'Вы уверены, что хотите закрыть комнату для всех?',
    failedToCloseRoom: 'Не удалось закрыть комнату',
    roomClosedForEveryone: 'Комната закрыта для всех',
    closeRoomRequestFailed: 'Не удалось отправить запрос на закрытие комнаты',

    // Auth
    signIn: 'Войти',
    signInSubtitle: 'Войдите для доступа к чатам, контактам и другим функциям',
    signInWithGoogle: 'Войти через Google',
    signUpTitle: 'Создать аккаунт',
    email: 'Email',
    passwordLabel: 'Пароль',
    displayNameLabel: 'Имя',
    noAccountSignUp: 'Нет аккаунта? Зарегистрируйтесь',
    alreadyHaveAccount: 'Уже есть аккаунт? Войти',
    joinAsGuest: 'Войти в комнату как гость',
    signOutButton: 'Выйти',
    signInToAccess: 'Войдите для доступа',

    // App Shell / Tabs
    homeTab: 'Главная',
    chatsTab: 'Чаты',
    contactsTab: 'Контакты',
    contactAdded: 'Контакт добавлен',
    location: 'Местоположение',
    currentLocation: 'Текущее местоположение',
    locationHistory: 'История местоположений',
    openInMaps: 'Открыть на карте',
    noLocationData: 'Нет данных о местоположении',
    deletedChat: '[Удалено]',
    roomsTab: 'Комнаты',
    optionsTab: 'Настройки',

    // Home
    greeting: 'Привет',
    homeSubtitle: 'Что вы хотите сделать?',
    newChat: 'Новый чат',
    joinRoomAction: 'Войти в комнату',
    newGroupChat: 'Новая группа',
    callContact: 'Позвонить',

    // Chats
    chatsTitle: 'Чаты',
    noConversations: 'Нет диалогов',
    startConversation: 'Начать диалог',
    noMessages: 'Нет сообщений',
    loading: 'Загрузка...',
    selectChat: 'Выберите чат',

    // Rooms
    roomsTitle: 'Комнаты',
    selectRoom: 'Создайте или войдите в комнату',
    recentRooms: 'Недавние комнаты',
    noRecentRooms: 'Нет недавних комнат',
    deleteRoom: 'Удалить',
    createRoom: 'Создать комнату',

    // Options
    profile: 'Профиль',

    // Chat conversation
    typeMessage: 'Введите сообщение...',
    typing: 'печатает...',
    members: 'Участники',
    confirmDelete: 'Удалить это сообщение?',
    deleteConversation: 'Удалить',
    confirmDeleteConversation: 'Удалить этот чат? Вся история сообщений будет удалена.',
    deletedChat: '[Удалено]',
    searchContacts: 'Поиск контактов...',
    noContactsFound: 'Контакты не найдены',
    groupNamePlaceholder: 'Название группы...',
    selectMembers: 'Выберите участников',
    createGroup: 'Создать группу',
  },
  en: {
    // Pre-join view
    videoConference: 'Video Conference',
    startOrJoinCall: 'Start or join a secure video call',
    username: 'Your Name',
    usernamePlaceholder: 'Enter your name',
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
    
    // Connection status
    signalingReconnecting: 'Reconnecting...',
    signalingDisconnected: 'Connection lost',

    // Alerts & Errors
    enterRoomId: 'Enter room id',
    passwordRequired: 'Password required',
    createRoomFailed: 'Create room failed',
    closeRoomConfirm: 'Are you sure you want to close the room for everyone?',
    failedToCloseRoom: 'Failed to close room',
    roomClosedForEveryone: 'Room closed for everyone',
    closeRoomRequestFailed: 'Close room request failed',

    // Auth
    signIn: 'Sign In',
    signInSubtitle: 'Sign in to access chats, contacts, and more',
    signInWithGoogle: 'Sign in with Google',
    signUpTitle: 'Create Account',
    email: 'Email',
    passwordLabel: 'Password',
    displayNameLabel: 'Display Name',
    noAccountSignUp: "Don't have an account? Sign Up",
    alreadyHaveAccount: 'Already have an account? Sign In',
    joinAsGuest: 'Join a room as guest',
    signOutButton: 'Sign Out',
    signInToAccess: 'Sign in to access',

    // App Shell / Tabs
    homeTab: 'Home',
    chatsTab: 'Chats',
    contactsTab: 'Contacts',
    contactAdded: 'Contact added',
    location: 'Location',
    currentLocation: 'Current Location',
    locationHistory: 'Location History',
    openInMaps: 'Open in Maps',
    noLocationData: 'No location data available',
    deletedChat: '[Deleted]',
    roomsTab: 'Rooms',
    optionsTab: 'Options',

    // Home
    greeting: 'Hello',
    homeSubtitle: 'What would you like to do?',
    newChat: 'New Chat',
    joinRoomAction: 'Join Room',
    newGroupChat: 'New Group',
    callContact: 'Call Contact',

    // Chats
    chatsTitle: 'Chats',
    noConversations: 'No conversations yet',
    startConversation: 'Start a conversation',
    noMessages: 'No messages yet',
    loading: 'Loading...',
    selectChat: 'Select a chat to start messaging',

    // Rooms
    roomsTitle: 'Rooms',
    selectRoom: 'Create or join a room to start a call',
    recentRooms: 'Recent Rooms',
    noRecentRooms: 'No recent rooms',
    deleteRoom: 'Delete',
    createRoom: 'Create Room',

    // Options
    profile: 'Profile',

    // Chat conversation
    typeMessage: 'Type a message...',
    typing: 'typing...',
    members: 'Members',
    confirmDelete: 'Delete this message?',
    deleteConversation: 'Delete',
    confirmDeleteConversation: 'Delete this chat? All message history will be permanently removed.',
    deletedChat: '[Deleted]',
    searchContacts: 'Search contacts...',
    noContactsFound: 'No contacts found',
    groupNamePlaceholder: 'Group name...',
    selectMembers: 'Select members',
    createGroup: 'Create Group',
  },
};