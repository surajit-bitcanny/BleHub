/**
 * Created by London on 8/7/17.
 */

/* Service */
exports.RENTLY_SERVICE = 'c3b44adba1a345b7be39e0a6ce8b5191';

/* Characteristics */
exports.COMMAND_CHAR = 'af90f7f1b9544b7b8899161b56ec5a78';
exports.CONN_TYPE_CHAR = '4d1a885006fc4fd5a771f5fc89158e1e';
exports.DEV_INFO_CHAR = '27486e578bcf4028adf076b89b8f13f3';
exports.DEV_STATUS_CHAR = '3f237fd2d65a477b8af22befd00f81ee';

/* Read/Indicate Status */
exports.STATUS = {
    INDICATE: 0x00,
    READ: 0x01,
    EOT: 0x02
};