/*
Copyright 2026 Gwang-Jin Kim

SPDX-License-Identifier: AGPL-3.0-only
Please see LICENSE in the repository root for full details.
*/
/** tr instructions for invitees creating their own account. */
export const tr = {
    language: "Dil",
    eyebrow: "ARKADAŞLAR İÇİN ÖZEL BİR ALAN",
    title: "Haydi sohbet edelim.",
    intro: "Kendi hesabınız. Birkaç basit adım. Size yol göstereceğiz.",
    account: "Hesap",
    app: "Uygulama",
    signIn: "Giriş",
    chat: "Sohbet",
    step1: "ADIM 1 / 4",
    accountTitle: "Kendi hesabınızı oluşturun",
    accountIntro: "Kendiniz için bir kullanıcı adı ve parola seçin.",
    inviteLabel: "Davet kodunuz veya kişisel davet bağlantınız",
    inviteHelp:
        "Josephus’un gönderdiği kişisel bağlantıyı açın. Kod buraya otomatik gelir. Ayrıca bir kod gönderilmez.",
    usernameLabel: "Kendi kullanıcı adınızı seçin",
    usernameHelp:
        "En az 3 karakter: küçük Latin harfleri (Türkçe karakter olmadan), rakam, nokta veya alt çizgi. Kendinize bir ad seçin.",
    yourAccount: "Hesabınız",
    passwordLabel: "Kendi parolanızı seçin",
    passwordHelp: "En az 12 karakter. Parola yöneticinizde veya güvenli bir yerde saklayın.",
    confirmLabel: "Aynı parolayı tekrar yazın",
    showPasswords: "Parolaları göster",
    create: "Hesabımı oluştur →",
    already: "Zaten kendi hesabım var →",
    step2: "ADIM 2 / 4",
    appTitle: "Cihazınızı seçin",
    created: "Hesabınız hazır.",
    browser: "Tarayıcı",
    androidInstall: "Google Play’den Element X’i yükleyin. Sonra bu sayfaya dönün.",
    googlePlay: "Google Play’den Element X’i yükle ↗",
    noPlay: "Google Play yok mu? APK indir",
    apkHelp:
        "Aşağıdaki APK dosyasını indirip açın. Android sorarsa bu tarayıcının uygulama yüklemesine izin verin ve Yükle’ye dokunun. Sonra bu izni kapatabilirsiniz. Gelecek güncellemeleri aynı kaynaktan indirin.",
    apkDownload: "Android APK’sını indir ↓",
    iphoneInstall: "App Store’dan Element X’i yükleyin. Sonra bu sayfaya dönün.",
    appStore: "App Store’dan Element X’i yükle ↗",
    browserInstall: "Tarayıcıda sohbet edebilirsiniz. Hiçbir şey yüklemeniz gerekmez.",
    installed: "Uygulamayı yükledim — devam →",
    step3: "ADIM 3 / 4",
    signinTitle: "Kendi hesabınıza giriş yapın",
    signinIntro: "Seçtiğiniz kullanıcı adını ve parolayı kullanın. Uygulamada ikinci bir hesap oluşturmanız gerekmez.",
    yourLogin: "Giriş için kendi kullanıcı adınız",
    copy: "Kopyala",
    provider: "Hesap sağlayıcısı / sunucu",
    mobile1:
        "Aşağıda “Element X’i aç” düğmesine dokunun. Sorulursa “Elle giriş yap” (Sign in manually) seçeneğini seçin.",
    mobile2:
        "Hesap sağlayıcısının chat.everyhub.org olduğunu kontrol edin. Değilse “Hesap sağlayıcısını değiştir” (Change account provider) seçeneğine dokunup bu adresi girin.",
    mobile3:
        "1. adımda seçtiğiniz kendi kullanıcı adınızı ve parolanızı girin. “Giriş yap” (Sign in) seçeneğine dokunun.",
    openApp: "Element X’i aç ↗",
    web1: "Aşağıdan web sohbetini açın ve “Giriş yap” (Sign in) seçeneğini seçin.",
    web2: "1. adımda seçtiğiniz kendi kullanıcı adınızı ve parolanızı girin. Sunucu chat.everyhub.org’dur.",
    openWeb: "Web sohbetini aç ↗",
    recovery:
        "Uygulama kurtarma anahtarını kaydetmenizi isterse güvenli bir yerde saklayın. Şifreli sohbetleri başka bir cihazda geri getirmenize yardımcı olur.",
    signedIn: "Giriş yaptım — devam →",
    step4: "ADIM 4 / 4",
    chatTitle: "Merhaba deyin",
    chatIntro: "Element X’te veya web sohbetinde yeni bir sohbet başlatın. Josephus’u bu adresle arayın:",
    contact: "Josephus’un iletişim adresi — sizin giriş adınız değil",
    hello: "Josephus katıldığınızı bilsin diye kısa bir “Merhaba!” gönderin.",
    later: "Başlamak için bu kadar yeter. Çeviri ve sesli mesajları daha sonra öğrenebilirsiniz.",
    languageGuide: "Daha sonra: çeviri ve sesli mesaj rehberi →",
    back: "← Geri",
    stuck: "Takıldınız mı?",
    tokenQuestion: "“Registration token” mı isteniyor?",
    tokenAnswer:
        "Josephus’un gönderdiği kişisel davet bağlantısına dönün ve önce burada hesabınızı oluşturun. Kod o bağlantının içindedir; e-postayla gönderilmez. Hesap oluşturulduktan sonra uygulamada giriş yapmayı seçin.",
    usedQuestion: "Davet kullanılmış veya süresi dolmuş mu?",
    usedAnswer:
        "Hesabınızı zaten oluşturduysanız yukarıda “Zaten kendi hesabım var” seçeneğini seçip giriş yapın. Aksi hâlde Josephus’tan yeni bir kişisel bağlantı isteyin.",
    loginQuestion: "Hangi hesabı kullanmalıyım?",
    loginAnswer:
        "Kendi kullanıcı adınız ve parolanızla kendi hesabınızı. Josephus’un adresi yalnızca ona yazmak içindir. Bu hesap Telegram hesabınızdan ayrıdır.",
    why: "Neden Everyhub Chat?",
    whyText:
        "Josephus bu sohbeti Hetzner’den kiraladığı bir sunucuda çalıştırıyor. Böylece sohbet hizmetimizi kendimiz yönetiyor ve kendi özelliklerimizi ekleyebiliyoruz. Açık kaynaklı Matrix ve Element kullanıyoruz.",
    privacy:
        "Şifreli sohbetler kullanın. Katılımcılar kendi kopyalarını saklar. Herkes çeviri asistanını davet etmeyi kabul ederse asistan o sohbeti okuyarak mesajları sunucumuzda çevirebilir veya kayıtları yazıya dökebilir. Bildirimler yine Apple veya Google hizmetlerini kullanabilir.",
    source: "Kaynak kodumuz — lisanslarına uygun değiştirin veya çatallayın ↗",
    returning: "Zaten katıldınız mı? Giriş yapın ↗",
    invitationReady: "Davetiniz hazır. Aşağıda kendi kullanıcı adınızı ve parolanızı seçin.",
    invitationMissing: "Kişisel davet bağlantınızı açın veya davet kodunuzu aşağıya yapıştırın.",
    yourUsername: "Kendi kullanıcı adınız",
    placeholder: "kullaniciadi",
    creating: "Hesabınız oluşturuluyor…",
    passwordMismatch: "Parolalar aynı değil. Aynı parolayı tekrar yazın.",
    invitationInvalid: "Kişisel bağlantınızı açın veya geçerli bir davet kodu yapıştırın.",
    invitationExpired:
        "Bu davet kullanılmış veya süresi dolmuş. Hesabınız hazırsa giriş yapın. Değilse Josephus’tan yeni bir bağlantı isteyin.",
    usernameTaken: "Bu ad zaten alınmış. Başka bir ad seçin — veya hesap sizinse giriş yapın.",
    rateLimited: "Çok fazla deneme yapıldı. Biraz bekleyip tekrar deneyin.",
    registrationError:
        "İşlem olmadı. Önce giriş yapıp yapamadığınızı kontrol edin. Olmazsa Josephus’tan yardım isteyin.",
    copied: "Kopyalandı.",
    copyFailed: "Adresi seçip elle kopyalayın.",
    missingUsername: "Kendi hesabınızı oluştururken seçtiğiniz kullanıcı adını kullanın.",
    browserNext: "Giriş adımına geç →",
    pageTitle: "Everyhub Chat’e katılın",
};
