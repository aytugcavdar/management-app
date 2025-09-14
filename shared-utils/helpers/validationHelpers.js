class ValidationHelpers {
  static sanitizeInput(input) {
    if (typeof input === 'string') {
      return input.trim().replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    }
    return input;
  }
  
  static sanitizeObject(obj) {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sanitized[key] = ValidationHelpers.sanitizeObject(value);
      } else if (Array.isArray(value)) {
        sanitized[key] = value.map(item => 
          typeof item === 'object' ? ValidationHelpers.sanitizeObject(item) : ValidationHelpers.sanitizeInput(item)
        );
      } else {
        sanitized[key] = ValidationHelpers.sanitizeInput(value);
      }
    }
    return sanitized;
  }
  
  static isValidObjectId(id) {
    return /^[0-9a-fA-F]{24}$/.test(id);
  }
  
  static normalizeEmail(email) {
    return email.toLowerCase().trim();
  }
  
  static validateFileType(file, allowedTypes) {
    return allowedTypes.includes(file.mimetype);
  }
  
  static validateFileSize(file, maxSizeInMB) {
    const maxSizeInBytes = maxSizeInMB * 1024 * 1024;
    return file.size <= maxSizeInBytes;
  }
}

module.exports = ValidationHelpers;