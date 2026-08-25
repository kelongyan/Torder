use super::{crypto, EncryptionContext};
use crate::error::{RepositoryError, RepositoryResult};
use crate::sync::credentials;
use crate::sync::manifest::{ChangeOperation, EncryptionConfig};

pub fn encryption_context(
    connection: &rusqlite::Connection,
    config: Option<&EncryptionConfig>,
) -> RepositoryResult<Option<EncryptionContext>> {
    let Some(config) = config else {
        return Ok(None);
    };
    crypto::validate_config(config)?;
    let stored = credentials::load_encryption_keys(connection)?;
    let key = crypto::stored_key(&stored, &config.key_id)?.ok_or(RepositoryError::Validation(
        "sync encryption password is required on this device",
    ))?;
    Ok(Some(EncryptionContext {
        config: config.clone(),
        key,
    }))
}

pub fn operation_associated_data(operation: &ChangeOperation) -> Vec<u8> {
    format!(
        "torder-sync-v2|{}|{}|{}|{}|{}",
        operation.id,
        operation.entity,
        operation.object_id,
        operation.operation,
        operation.revision
    )
    .into_bytes()
}

pub fn encrypt_operations(
    operations: &mut [ChangeOperation],
    context: Option<&EncryptionContext>,
) -> RepositoryResult<()> {
    let Some(context) = context else {
        return Ok(());
    };
    for operation in operations {
        operation.payload = crypto::encrypt_value(
            &operation.payload,
            &context.config.key_id,
            &context.key,
            &operation_associated_data(operation),
        )?;
    }
    Ok(())
}

pub fn decrypt_operations(
    operations: &mut [ChangeOperation],
    context: Option<&EncryptionContext>,
) -> RepositoryResult<()> {
    for operation in operations {
        match context {
            Some(context) => {
                operation.payload = crypto::decrypt_value(
                    &operation.payload,
                    &context.config.key_id,
                    &context.key,
                    &operation_associated_data(operation),
                )?;
            }
            None if operation.payload.get("$encrypted").is_some() => {
                return Err(RepositoryError::Validation(
                    "encrypted sync payload requires encryption configuration",
                ));
            }
            None => {}
        }
    }
    Ok(())
}
