use serde::{Deserialize, Serialize};

// Deliberately no Debug implementation: this value contains a password.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedLogin {
    pub server_url: String,
    pub name: String,
    pub password: String,
}
impl SavedLogin {
    fn validate(&self) -> Result<(), String> {
        crate::control::validate_server_url(&self.server_url)?;
        if self.server_url.len() > 1000
            || !(2..=40).contains(&self.name.chars().count())
            || !(10..=128).contains(&self.password.chars().count())
        {
            return Err("SAVED_LOGIN_INVALID".into());
        }
        Ok(())
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_NOT_FOUND},
        Security::Credentials::*,
    };
    fn target() -> Vec<u16> {
        "com.musicshare.desktop/auto-login"
            .encode_utf16()
            .chain(Some(0))
            .collect()
    }
    pub fn save(value: &SavedLogin) -> Result<(), String> {
        value.validate()?;
        let mut blob = serde_json::to_vec(value).map_err(|_| "SAVED_LOGIN_INVALID")?;
        if blob.len() > 2560 {
            return Err("SAVED_LOGIN_INVALID".into());
        }
        let mut target = target();
        let mut username: Vec<u16> = value.name.encode_utf16().chain(Some(0)).collect();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: username.as_mut_ptr(),
            ..Default::default()
        };
        let ok = unsafe { CredWriteW(&credential, 0) };
        blob.fill(0);
        if ok == 0 {
            Err("SAVED_LOGIN_WRITE_FAILED".into())
        } else {
            Ok(())
        }
    }
    pub fn load() -> Result<Option<SavedLogin>, String> {
        let target = target();
        let mut credential = std::ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) } == 0 {
            return if unsafe { GetLastError() } == ERROR_NOT_FOUND {
                Ok(None)
            } else {
                Err("SAVED_LOGIN_READ_FAILED".into())
            };
        }
        // Windows owns the allocation; always release it, even on malformed data.
        let result = unsafe {
            let c = &*credential;
            if c.CredentialBlob.is_null()
                || c.CredentialBlobSize == 0
                || c.CredentialBlobSize > 2560
            {
                Err("SAVED_LOGIN_INVALID".to_owned())
            } else {
                serde_json::from_slice::<SavedLogin>(std::slice::from_raw_parts(
                    c.CredentialBlob,
                    c.CredentialBlobSize as usize,
                ))
                .map_err(|_| "SAVED_LOGIN_INVALID".to_owned())
            }
        };
        unsafe {
            CredFree(credential.cast());
        }
        let value = result?;
        value.validate()?;
        Ok(Some(value))
    }
    pub fn clear() -> Result<(), String> {
        if unsafe { CredDeleteW(target().as_ptr(), CRED_TYPE_GENERIC, 0) } != 0
            || unsafe { GetLastError() } == ERROR_NOT_FOUND
        {
            Ok(())
        } else {
            Err("SAVED_LOGIN_DELETE_FAILED".into())
        }
    }
}
#[cfg(not(windows))]
mod platform {
    use super::*;
    pub fn save(_: &SavedLogin) -> Result<(), String> {
        Err("SAVED_LOGIN_UNSUPPORTED".into())
    }
    pub fn load() -> Result<Option<SavedLogin>, String> {
        Ok(None)
    }
    pub fn clear() -> Result<(), String> {
        Ok(())
    }
}
pub use platform::{clear, load, save};

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> SavedLogin {
        SavedLogin {
            server_url: "http://127.0.0.1:3000".into(),
            name: "tester".into(),
            password: "example-password".into(),
        }
    }
    #[test]
    fn validates_and_roundtrips_without_using_real_credentials() {
        let value = sample();
        assert!(value.validate().is_ok());
        let json = serde_json::to_vec(&value).unwrap();
        let restored: SavedLogin = serde_json::from_slice(&json).unwrap();
        assert_eq!(restored.server_url, value.server_url);
        assert_eq!(restored.name, value.name);
        assert!(restored.password == value.password);
    }
    #[test]
    fn rejects_unsafe_servers_and_invalid_lengths() {
        for url in [
            "file:///password",
            "http://example.com",
            "https://u:p@example.com",
        ] {
            let mut value = sample();
            value.server_url = url.into();
            assert!(value.validate().is_err());
        }
        let mut value = sample();
        value.password = "short".into();
        assert!(value.validate().is_err());
        let mut value = sample();
        value.name = "x".repeat(41);
        assert!(value.validate().is_err());
    }
}
