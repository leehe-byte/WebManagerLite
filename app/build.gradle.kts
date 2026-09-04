plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.opengw.manager"
    compileSdk = 33

    defaultConfig {
        applicationId = "com.opengw.manager"
        minSdk = 26
        targetSdk = 33
        versionCode = 37
        versionName = "3.1.0"
        // 编译产物命名为"应用名-版本-构建类型.apk"，如 OpenGW-3.1.0-release.apk
        setProperty("archivesBaseName", "${rootProject.name}-${versionName}")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.9.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")

    val ktor_version = "2.3.7"
    implementation("io.ktor:ktor-server-core:$ktor_version")
    implementation("io.ktor:ktor-server-cio:$ktor_version")
    implementation("io.ktor:ktor-server-call-logging:$ktor_version")
    implementation("io.ktor:ktor-server-websockets:$ktor_version")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
}
